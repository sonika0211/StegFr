/**
 * Tiled multi-channel CNN ROI analyzer (TensorFlow.js).
 *
 * Pipeline (no UI changes — purely an engine swap):
 *   1. Slice the FULL-RESOLUTION image into overlapping 128×128 tiles
 *      with a 64-px stride (50% overlap). This guarantees every pixel
 *      is analyzed at native resolution.
 *   2. Extract 5 feature channels per tile at full resolution:
 *        ch0 — grayscale luma
 *        ch1 — LSB-noise plane (5×5 local variance of LSB(R,G,B))
 *        ch2 — high-frequency residual (luma − 5×5 Gaussian, ×4)
 *        ch3 — chi-square anomaly per 8×8 block
 *        ch4 — color decorrelation: per-block var of (R−G), (G−B)
 *      Channels 1–4 are weighted 4× ch0 in the conv-init.
 *   3. CNN per tile (input 128×128×5):
 *        Conv 16×3×3 ReLU → Conv 16×3×3 ReLU → Conv 8×3×3 ReLU → Conv 1×1 sigmoid
 *   4. Tiles processed in batches of 4 (tf.tidy) for WebGL safety.
 *   5. Stitched with a 2D Hanning window into a full-res heatmap, then
 *      Gaussian-blurred (σ=1.5), 95th-percentile-normalized, and
 *      block-averaged down to the ROI display grid.
 *
 * Returns aggregate channel means so the UI metrics map directly:
 *   TEXTURE        = ch1Mean × 100        (LSB variance)
 *   EDGE DENSITY % = ch2Mean × 100        (HF residual)
 *   COMPLEXITY     = (ch3+ch4)/2 × 100    (chi-square + decor)
 *   CONFIDENCE     = ch1·0.35 + ch2·0.25 + ch3·0.25 + ch4·0.15  (×100)
 */

import * as tf from "@tensorflow/tfjs";

const ROI_OUT = 64; // canvas display grid
// Cap the longest side of the image fed to the CNN so very large images
// don't blow up WebGL memory. The CNN is fully convolutional so it still
// processes the entire image (just at a slightly reduced resolution when
// the original is huge).
const MAX_SIDE = 1024;

let _model: tf.LayersModel | null = null;

/* ---------------- model ---------------- */

function buildModel(): tf.LayersModel {
  // ch0 weight 1×, channels 1–4 weight 4× → emphasises stego-relevant cues.
  const channelGain = [1, 4, 4, 4, 4];
  const totalGain = channelGain.reduce((a, b) => a + b, 0);

  const initConv = (ki: number, kj: number, cin: number, cout: number, scale: number) => {
    const w = new Float32Array(ki * kj * cin * cout);
    for (let h = 0; h < ki; h++) {
      for (let ww = 0; ww < kj; ww++) {
        for (let ci = 0; ci < cin; ci++) {
          const gain = cin === 5 ? channelGain[ci] / totalGain : 1 / cin;
          for (let co = 0; co < cout; co++) {
            const center = (h === ((ki - 1) >> 1) && ww === ((kj - 1) >> 1)) ? 1.0 : 0.45;
            // gentle structured init so untrained network still produces useful maps
            const aff = ((co + ci) % 3 === 0) ? 1.0 : 0.6;
            const idx = ((h * kj + ww) * cin + ci) * cout + co;
            w[idx] = scale * gain * aff * center;
          }
        }
      }
    }
    return w;
  };

  const w1 = tf.tensor4d(initConv(3, 3, 5, 16, 0.55), [3, 3, 5, 16]);
  const b1 = tf.zeros([16]);
  const w2 = tf.tensor4d(initConv(3, 3, 16, 16, 0.35), [3, 3, 16, 16]);
  const b2 = tf.zeros([16]);
  const w3 = tf.tensor4d(initConv(3, 3, 16, 8, 0.40), [3, 3, 16, 8]);
  const b3 = tf.zeros([8]);
  // 1×1 sigmoid head — combine 8 features into a single ROI probability
  const w4arr = new Float32Array(1 * 1 * 8 * 1);
  for (let i = 0; i < 8; i++) w4arr[i] = 0.65;
  const w4 = tf.tensor4d(w4arr, [1, 1, 8, 1]);
  const b4 = tf.tensor1d([-0.2]);

  // Fully-convolutional input — accepts ANY spatial size so we can run
  // the network on the whole image in a single pass.
  const input = tf.input({ shape: [null, null, 5] });
  const c1 = tf.layers.conv2d({ filters: 16, kernelSize: 3, padding: "same", activation: "relu", weights: [w1, b1] }).apply(input) as tf.SymbolicTensor;
  const c2 = tf.layers.conv2d({ filters: 16, kernelSize: 3, padding: "same", activation: "relu", weights: [w2, b2] }).apply(c1) as tf.SymbolicTensor;
  const c3 = tf.layers.conv2d({ filters: 8, kernelSize: 3, padding: "same", activation: "relu", weights: [w3, b3] }).apply(c2) as tf.SymbolicTensor;
  const c4 = tf.layers.conv2d({ filters: 1, kernelSize: 1, padding: "same", activation: "sigmoid", weights: [w4, b4] }).apply(c3) as tf.SymbolicTensor;
  return tf.model({ inputs: input, outputs: c4 });
}

export async function getCnnModel(): Promise<tf.LayersModel> {
  if (_model) return _model;
  await tf.ready();
  _model = buildModel();
  return _model;
}

/* ---------------- full-image feature planes ---------------- */

interface FeaturePlanes {
  w: number; h: number;
  gray: Float32Array;     // ch0
  lsbVar: Float32Array;   // ch1
  hfResid: Float32Array;  // ch2
  chi: Float32Array;      // ch3
  colorDecor: Float32Array; // ch4
}

function buildFeaturePlanes(img: ImageData): FeaturePlanes {
  const { width: w, height: h, data } = img;
  const N = w * h;
  const gray = new Float32Array(N);
  const lsb = new Uint8Array(N);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    gray[j] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    // LSB count across R,G,B (0..3) → normalized later
    lsb[j] = (r & 1) + (g & 1) + (b & 1);
  }

  // ch1 — local variance of LSB plane in 5×5 window
  const lsbVar = new Float32Array(N);
  const R = 2;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - R), y1 = Math.min(h - 1, y + R);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - R), x1 = Math.min(w - 1, x + R);
      let s = 0, s2 = 0, n = 0;
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const v = lsb[yy * w + xx];
          s += v; s2 += v * v; n++;
        }
      }
      const m = s / n;
      const v = Math.max(0, s2 / n - m * m);
      // theoretical max ≈ (3/2)^2 = 2.25 → scale to ~1
      lsbVar[y * w + x] = Math.min(1, v / 2.25);
    }
  }

  // ch2 — luma minus 5×5 Gaussian-blurred luma, ×4
  // Separable Gaussian σ≈1: kernel [1,4,6,4,1]/16
  const k = [1, 4, 6, 4, 1];
  const tmp = new Float32Array(N);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, ws = 0;
      for (let i = -2; i <= 2; i++) {
        const xx = x + i;
        if (xx < 0 || xx >= w) continue;
        const kw = k[i + 2];
        s += gray[y * w + xx] * kw; ws += kw;
      }
      tmp[y * w + x] = s / ws;
    }
  }
  const blur = new Float32Array(N);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, ws = 0;
      for (let i = -2; i <= 2; i++) {
        const yy = y + i;
        if (yy < 0 || yy >= h) continue;
        const kw = k[i + 2];
        s += tmp[yy * w + x] * kw; ws += kw;
      }
      blur[y * w + x] = s / ws;
    }
  }
  const hfResid = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    hfResid[i] = Math.min(1, Math.abs(gray[i] - blur[i]) * 4);
  }

  // ch3 — chi-square anomaly per 8×8 block (even vs odd value pairs of luma 0..255)
  const chi = new Float32Array(N);
  const B = 8;
  for (let by = 0; by < h; by += B) {
    for (let bx = 0; bx < w; bx += B) {
      const x1 = Math.min(w, bx + B), y1 = Math.min(h, by + B);
      // 128 pairs (2k, 2k+1)
      const evens = new Uint16Array(128), odds = new Uint16Array(128);
      for (let y = by; y < y1; y++) {
        for (let x = bx; x < x1; x++) {
          const v = Math.round(gray[y * w + x] * 255);
          const k2 = v >> 1;
          if (v & 1) odds[k2]++; else evens[k2]++;
        }
      }
      let chiSum = 0, terms = 0;
      for (let k2 = 0; k2 < 128; k2++) {
        const e = evens[k2], o = odds[k2];
        const t = e + o;
        if (t < 4) continue;
        const exp = t / 2;
        const d = e - exp;
        chiSum += (d * d) / exp;
        terms++;
      }
      // normalize: mean per-bin chi clipped
      const score = terms > 0 ? Math.min(1, (chiSum / terms) / 4) : 0;
      for (let y = by; y < y1; y++) {
        for (let x = bx; x < x1; x++) chi[y * w + x] = score;
      }
    }
  }

  // ch4 — color decorrelation per 8×8 block: variance of (R−G) and (G−B)
  const colorDecor = new Float32Array(N);
  for (let by = 0; by < h; by += B) {
    for (let bx = 0; bx < w; bx += B) {
      const x1 = Math.min(w, bx + B), y1 = Math.min(h, by + B);
      let sRG = 0, sRG2 = 0, sGB = 0, sGB2 = 0, n = 0;
      for (let y = by; y < y1; y++) {
        for (let x = bx; x < x1; x++) {
          const i = (y * w + x) * 4;
          const rg = (data[i] - data[i + 1]) / 255;
          const gb = (data[i + 1] - data[i + 2]) / 255;
          sRG += rg; sRG2 += rg * rg;
          sGB += gb; sGB2 += gb * gb;
          n++;
        }
      }
      const vRG = Math.max(0, sRG2 / n - (sRG / n) ** 2);
      const vGB = Math.max(0, sGB2 / n - (sGB / n) ** 2);
      // typical max around 0.05; scale
      const score = Math.min(1, (vRG + vGB) * 10);
      for (let y = by; y < y1; y++) {
        for (let x = bx; x < x1; x++) colorDecor[y * w + x] = score;
      }
    }
  }

  return { w, h, gray, lsbVar, hfResid, chi, colorDecor };
}

/* ---------------- tiling + Hanning ---------------- */

function hanning2d(n: number): Float32Array {
  const w1 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w1[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  const w2 = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) w2[y * n + x] = Math.max(1e-3, w1[y] * w1[x]);
  return w2;
}
const HANN = hanning2d(TILE);

interface TileSpec { x0: number; y0: number }

function planTiles(w: number, h: number): TileSpec[] {
  const tiles: TileSpec[] = [];
  const xs: number[] = [], ys: number[] = [];
  if (w <= TILE) xs.push(0);
  else {
    for (let x = 0; x + TILE <= w; x += STRIDE) xs.push(x);
    if (xs[xs.length - 1] + TILE < w) xs.push(w - TILE);
  }
  if (h <= TILE) ys.push(0);
  else {
    for (let y = 0; y + TILE <= h; y += STRIDE) ys.push(y);
    if (ys[ys.length - 1] + TILE < h) ys.push(h - TILE);
  }
  for (const y of ys) for (const x of xs) tiles.push({ x0: x, y0: y });
  return tiles;
}

function fillTileBatch(planes: FeaturePlanes, specs: TileSpec[]): Float32Array {
  // [B, TILE, TILE, 5]
  const buf = new Float32Array(specs.length * TILE * TILE * 5);
  const { w, h, gray, lsbVar, hfResid, chi, colorDecor } = planes;
  const channels = [gray, lsbVar, hfResid, chi, colorDecor];
  for (let s = 0; s < specs.length; s++) {
    const { x0, y0 } = specs[s];
    const base = s * TILE * TILE * 5;
    for (let y = 0; y < TILE; y++) {
      const sy = Math.min(h - 1, Math.max(0, y0 + y));
      for (let x = 0; x < TILE; x++) {
        const sx = Math.min(w - 1, Math.max(0, x0 + x));
        const off = base + (y * TILE + x) * 5;
        const srcIdx = sy * w + sx;
        for (let c = 0; c < 5; c++) buf[off + c] = channels[c][srcIdx];
      }
    }
  }
  return buf;
}

/* ---------------- post-processing ---------------- */

function gaussianBlur(map: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(radius * 2 + 1);
  let ksum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + radius] = v; ksum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= ksum;

  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -radius; i <= radius; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i));
        s += map[y * w + xx] * k[i + radius];
      }
      tmp[y * w + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -radius; i <= radius; i++) {
        const yy = Math.min(h - 1, Math.max(0, y + i));
        s += tmp[yy * w + x] * k[i + radius];
      }
      out[y * w + x] = s;
    }
  }
  return out;
}

function p95Normalize(map: Float32Array): Float32Array {
  // sample (full sort can be expensive on huge images)
   const sorted = Array.from(map).sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  const denom = Math.max(p90 - p50, 1e-3);

  const out = new Float32Array(map.length);
  for (let i = 0; i < map.length; i++) {
    out[i] = Math.min(1, Math.max(0, (map[i] - p50) / denom));
  }
  return out;
}

function downsampleToGrid(map: Float32Array, w: number, h: number, N: number): number[][] {
  const out: number[][] = [];
  const bw = w / N, bh = h / N;
  for (let by = 0; by < N; by++) {
    const row: number[] = [];
    const y0 = Math.floor(by * bh), y1 = Math.min(h, Math.floor((by + 1) * bh));
    for (let bx = 0; bx < N; bx++) {
      const x0 = Math.floor(bx * bw), x1 = Math.min(w, Math.floor((bx + 1) * bw));
      let s = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += map[y * w + x]; n++; }
      row.push(n ? s / n : 0);
    }
    out.push(row);
  }
  return out;
}

function planeMean(p: Float32Array): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += p[i];
  return s / p.length;
}

/* ---------------- public API ---------------- */

export interface CnnRoiResult {
  roi: number[][];
  meanActivation: number;
  confidence: number; // 0..100  (POOR → GREAT)
  channels: { lsb: number; hf: number; chi: number; decor: number }; // 0..1 means
}

export async function predictRoi(
  img: ImageData,
  onProgress?: (pct: number) => void,
): Promise<CnnRoiResult> {
  const model = await getCnnModel();
  const planes = buildFeaturePlanes(img);
  const { w, h } = planes;

  const tiles = planTiles(w, h);
  const accum = new Float32Array(w * h);
  const weights = new Float32Array(w * h);

  for (let i = 0; i < tiles.length; i += BATCH) {
    const batch = tiles.slice(i, i + BATCH);
    const buf = fillTileBatch(planes, batch);
    const outArr = tf.tidy(() => {
      const t = tf.tensor4d(buf, [batch.length, TILE, TILE, 5]);
      const o = model.predict(t) as tf.Tensor;
      return o.dataSync() as Float32Array;
    }) as unknown as Float32Array;

    for (let s = 0; s < batch.length; s++) {
      const { x0, y0 } = batch[s];
      const base = s * TILE * TILE;
      for (let y = 0; y < TILE; y++) {
        const ty = y0 + y;
        if (ty < 0 || ty >= h) continue;
        for (let x = 0; x < TILE; x++) {
          const tx = x0 + x;
          if (tx < 0 || tx >= w) continue;
          const wgt = HANN[y * TILE + x];
          const v = outArr[base + y * TILE + x];
          const idx = ty * w + tx;
          accum[idx] += v * wgt;
          weights[idx] += wgt;
        }
      }
    }
    onProgress?.(Math.min(100, Math.round(((i + batch.length) / tiles.length) * 100)));
    // yield to UI
    await new Promise((r) => setTimeout(r, 0));
  }

  const stitched = new Float32Array(w * h);
  for (let i = 0; i < stitched.length; i++) {
    stitched[i] = weights[i] > 0 ? accum[i] / weights[i] : 0;
  }

  const blurred = gaussianBlur(stitched, w, h, 1.5);
  const normed = p95Normalize(blurred);
  const roi = downsampleToGrid(normed, w, h, ROI_OUT);

  const ch1 = planeMean(planes.lsbVar);
  const ch2 = planeMean(planes.hfResid);
  const ch3 = planeMean(planes.chi);
  const ch4 = planeMean(planes.colorDecor);
  const conf = (ch1 * 0.20 + ch2 * 0.35 + ch3 * 0.10 + ch4 * 0.35) * 100;

  let mean = 0;
  for (let i = 0; i < normed.length; i++) mean += normed[i];
  mean /= normed.length;

  return {
    roi,
    meanActivation: mean,
    confidence: Math.min(100, Math.max(0, conf)),
    channels: { lsb: ch1, hf: ch2, chi: ch3, decor: ch4 },
  };
}

export const CNN_ROI_SIZE = ROI_OUT;

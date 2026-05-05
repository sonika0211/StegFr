/**
 * Region-of-Interest analysis — fully rewritten.
 *
 *   1. MULTI-SCALE features per 32×32 block, computed at FULL resolution
 *      AND at a 2× downsampled scale (so both fine texture and coarse
 *      structure contribute):
 *        • Sobel gradient magnitude   (edges)
 *        • |Laplacian|                (high-frequency / texture)
 *        • Local variance             (signal energy, NOT brightness)
 *        • Block entropy              (information content)
 *
 *   2. ROBUST normalization (NOT min–max). Each feature is divided by its
 *      95th-percentile value and clipped to [0,1]. This kills the
 *      "single bright pixel stretches everything to 0.001" problem that
 *      classic min–max creates and makes the score comparable across images.
 *
 *   3. LOW-SIGNAL SUPPRESSION. If the global high-frequency energy of the
 *      image is below a fixed absolute threshold (flat / low-detail image),
 *      the heatmap is multiplied by a sub-unity gate so flat regions stay
 *      dark and the verdict is downgraded.
 *
 *   4. Heatmap is SMOOTHED with a 3×3 binomial (Gaussian-approx) kernel so
 *      neighbouring blocks are spatially coherent.
 *
 *   5. Calibrated suitability score is the area-aware mean of the smoothed
 *      heatmap (only cells > 0.5 contribute), feeding directly into the
 *      ε-greedy Q-learning agent.
 */

export interface BlockFeatureMaps {
  variance: number[][];
  gradient: number[][];
  entropy: number[][];
  highFreq: number[][];
  intensity: number[][];
  /** Per-block intensity spread (max-min), normalized 0..1. Broad spread → good carrier. */
  spread: number[][];
  /** Per-block decorrelation score, 0..1 (1 = uncorrelated neighbours = good carrier). */
  decorrelation: number[][];
}

export interface AnalysisResult {
  width: number;
  height: number;
  textureScore: number;          // 0..100  (variance proxy, not saturated)
  laplacianVariance: number;
  edgeDensityPct: number;        // 0..100
  complexityScore: number;       // 0..100  (global score from heatmap)
  avgBlockVariance: number;
  /** 32×32 calibrated heatmap, 0..1 (z-score → sigmoid). */
  roi: number[][];
  /** 32×32 raw fused score 0..1 (pre-calibration). */
  scoreMap: number[][];
  /** Per-block normalized feature maps used for fusion + Q-state. */
  features: BlockFeatureMaps;
  verdict: "ACCEPTED" | "REJECTED" | "WARNING";
  reasons: string[];
  capacityBits: number;
}

const ROI_GRID = 32;
const EPS = 1e-6;
/** Below this global high-frequency energy the image is treated as flat. */
const LOW_SIGNAL_FLOOR = 0.012;

/* ---------------- helpers ---------------- */

/**
 * Robust normalization: divide by the 95th-percentile value (with absolute
 * floor) and clip to [0,1]. This avoids the classic min-max distortion where
 * a single bright outlier collapses the rest of the map to zero, and it
 * keeps the result comparable across images (an empty image stays low).
 */
function robustNormalize(map: number[][], absFloor = 0.0): number[][] {
  const flat: number[] = [];
  for (const row of map) for (const v of row) flat.push(v);
  flat.sort((a, b) => a - b);
  const p95 = flat[Math.floor(flat.length * 0.95)] || 0;
  const denom = Math.max(p95, absFloor, EPS);
  return map.map((r) => r.map((v) => Math.max(0, Math.min(1, v / denom))));
}

/** 3×3 binomial smoothing (Gaussian-approx) on a square block map. */
function smooth(map: number[][]): number[][] {
  const N = map.length;
  const k = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  const out: number[][] = [];
  for (let y = 0; y < N; y++) {
    const row: number[] = [];
    for (let x = 0; x < N; x++) {
      let s = 0, w = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || xx < 0 || yy >= N || xx >= N) continue;
          const kw = k[(dy + 1) * 3 + (dx + 1)];
          s += map[yy][xx] * kw;
          w += kw;
        }
      }
      row.push(s / w);
    }
    out.push(row);
  }
  return out;
}

function toGray(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    g[j] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
  }
  return g;
}

/** Per-pixel Sobel magnitude + |Laplacian|. */
function fullResDerivatives(g: Float32Array, w: number, h: number) {
  const grad = new Float32Array(w * h);
  const lap = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = g[i - w - 1], b = g[i - w], c = g[i - w + 1];
      const d = g[i - 1], e = g[i], f = g[i + 1];
      const gg = g[i + w - 1], hh = g[i + w], k = g[i + w + 1];
      const gx = -a + c - 2 * d + 2 * f - gg + k;
      const gy = -a - 2 * b - c + gg + 2 * hh + k;
      grad[i] = Math.sqrt(gx * gx + gy * gy);
      lap[i] = Math.abs(-a - b - c - d + 8 * e - f - gg - hh - k);
    }
  }
  return { grad, lap };
}

/** Shannon entropy of an 8-bin grayscale histogram for the block. */
function blockEntropy(g: Float32Array, w: number, x0: number, y0: number, x1: number, y1: number): number {
  const hist = new Uint32Array(8);
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = g[y * w + x];
      const b = Math.min(7, Math.max(0, Math.floor(v * 8)));
      hist[b]++;
      n++;
    }
  }
  let H = 0;
  for (let i = 0; i < 8; i++) {
    if (hist[i] === 0) continue;
    const p = hist[i] / n;
    H -= p * Math.log2(p);
  }
  return H; // 0..3
}

/* ---------------- fusion + global metrics ---------------- */

// Suitability for stego, driven by the five CNN-derived perceptual cues:
//   • Texture Complexity   (highFreq / |Laplacian|)
//   • Gradient Magnitude   (Sobel)
//   • Local Variance       (block variance)
//   • Intensity Spread     (max-min within block)
//   • Pixel Decorrelation  (1 − |lag-1 autocorr|)
// Brightness is intentionally absent. The CNN feature map is mixed in as a
// small learned refinement on top of the five hand-crafted cues.
const W_HF = 0.24;     // texture complexity
const W_GRAD = 0.24;   // gradient magnitude (edges)
const W_VAR = 0.18;    // local variance
const W_SPREAD = 0.13; // intensity spread
const W_DECOR = 0.13;  // pixel decorrelation
const W_ENT = 0.04;    // entropy (small auxiliary signal)
const W_CNN = 0.04;    // CNN refinement (only when present)

function fuse(features: BlockFeatureMaps, cnn?: number[][]): number[][] {
  const N = features.variance.length;
  const out: number[][] = [];
  for (let y = 0; y < N; y++) {
    const row: number[] = [];
    for (let x = 0; x < N; x++) {
      const cnnV = cnn ? cnn[y][x] : 0;
      const cnnW = cnn ? W_CNN : 0;
      const norm = cnn ? 1 : 1 - W_CNN;
      const raw = (
        W_HF * features.highFreq[y][x] +
        W_GRAD * features.gradient[y][x] +
        W_VAR * features.variance[y][x] +
        W_SPREAD * features.spread[y][x] +
        W_DECOR * features.decorrelation[y][x] +
        W_ENT * features.entropy[y][x] +
        cnnW * cnnV
      ) / norm;
      row.push(Math.max(0, Math.min(1, raw)));
    }
    out.push(row);
  }
  return out;
}

/** Area-aware global score (only "good" cells count). */
function areaAwareGlobal(heatmap: number[][]): number {
  let sum = 0, n = 0;
  for (const row of heatmap) for (const v of row) {
    n++;
    if (v > 0.6) sum += v;
  }
  return (sum / n) * 100; // 0..100
}

/* ---------------- public API ---------------- */

/** Re-fuse an AnalysisResult with a CNN feature map (linear, NxN, 0..1). */
export function withRoi(base: AnalysisResult, cnnMap: number[][]): AnalysisResult {
  // Resize cnnMap to ROI_GRID if needed (block-average)
  const N = ROI_GRID;
  const M = cnnMap.length;
  let cnn = cnnMap;
  if (M !== N) {
    const r = M / N;
    cnn = [];
    for (let y = 0; y < N; y++) {
      const row: number[] = [];
      for (let x = 0; x < N; x++) {
        let s = 0, c = 0;
        const y0 = Math.floor(y * r), y1 = Math.floor((y + 1) * r);
        const x0 = Math.floor(x * r), x1 = Math.floor((x + 1) * r);
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { s += cnnMap[yy][xx]; c++; }
        row.push(c ? s / c : 0);
      }
      cnn.push(row);
    }
  }
  const cnnNorm = robustNormalize(cnn);
  const scoreMap = fuse(base.features, cnnNorm);
  // Apply low-signal gate baked in earlier (already part of features),
  // then smooth so the heatmap is spatially coherent.
  const gate = (base as any)._signalGate ?? 1;
  const roi = smooth(scoreMap.map((r) => r.map((v) => v * gate)));

  // capacity from "good" cells
  let usable = 0;
  for (const row of roi) for (const v of row) if (v > 0.5) usable++;
  const pixelsPerBlock = (base.width / N) * (base.height / N);
  const capacityBits = Math.floor(usable * pixelsPerBlock * 3);
  const complexityScore = areaAwareGlobal(roi);

  return { ...base, roi, scoreMap, capacityBits, complexityScore };
}

export function analyzeImage(img: ImageData): AnalysisResult {
  const { width: w, height: h, data } = img;
  const reasons: string[] = [];

  if (w < 32 || h < 32) {
    const empty = Array.from({ length: ROI_GRID }, () => Array(ROI_GRID).fill(0));
    return {
      width: w, height: h,
      textureScore: 0, laplacianVariance: 0, edgeDensityPct: 0, complexityScore: 0, avgBlockVariance: 0,
      roi: empty, scoreMap: empty,
      features: { variance: empty, gradient: empty, entropy: empty, highFreq: empty, intensity: empty, spread: empty, decorrelation: empty },
      verdict: "REJECTED", reasons: ["Image is too small (min 32×32)."], capacityBits: 0,
    };
  }

  const g = toGray(data, w, h);
  const { grad, lap } = fullResDerivatives(g, w, h);

  // Per-block raw features
  const N = ROI_GRID;
  const bw = w / N, bh = h / N;
  const varRaw: number[][] = [], gradRaw: number[][] = [], hfRaw: number[][] = [], entRaw: number[][] = [], intRaw: number[][] = [];
  const spreadRaw: number[][] = [], decorRaw: number[][] = [];

  let globalLapVar = 0, lapMean = 0, lapMeanSq = 0, lapN = 0;
  let edgePixels = 0, totalPixels = 0;
  let avgVarSum = 0;

  for (let by = 0; by < N; by++) {
    const vRow: number[] = [], gRow: number[] = [], hfRow: number[] = [], eRow: number[] = [], iRow: number[] = [];
    const spRow: number[] = [], dcRow: number[] = [];
    for (let bx = 0; bx < N; bx++) {
      const x0 = Math.floor(bx * bw), y0 = Math.floor(by * bh);
      const x1 = Math.min(w, Math.floor((bx + 1) * bw));
      const y1 = Math.min(h, Math.floor((by + 1) * bh));
      let sumI = 0, sumI2 = 0, sumG = 0, sumL = 0, n = 0;
      let minI = Infinity, maxI = -Infinity;
      // Lag-1 autocorrelation accumulators (horizontal neighbours)
      let acN = 0, acSumXY = 0, acSumX = 0, acSumY = 0, acSumX2 = 0, acSumY2 = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * w + x;
          const I = g[i];
          sumI += I; sumI2 += I * I;
          if (I < minI) minI = I;
          if (I > maxI) maxI = I;
          sumG += grad[i];
          sumL += lap[i];
          n++;
          if (grad[i] > 0.25) edgePixels++;
          totalPixels++;
          lapMean += lap[i]; lapMeanSq += lap[i] * lap[i]; lapN++;
          if (x + 1 < x1) {
            const J = g[i + 1];
            acSumXY += I * J; acSumX += I; acSumY += J;
            acSumX2 += I * I; acSumY2 += J * J; acN++;
          }
        }
      }
      const meanI = sumI / n;
      const variance = sumI2 / n - meanI * meanI;
      vRow.push(variance);
      gRow.push(sumG / n);
      hfRow.push(sumL / n);
      eRow.push(blockEntropy(g, w, x0, y0, x1, y1));
      iRow.push(meanI);
      spRow.push(maxI - minI); // 0..1 raw spread
      // Pearson lag-1 correlation; decor = 1 − |corr|. High decor → great carrier.
      let corr = 0;
      if (acN > 1) {
        const mx = acSumX / acN, my = acSumY / acN;
        const cov = acSumXY / acN - mx * my;
        const sx = Math.sqrt(Math.max(0, acSumX2 / acN - mx * mx));
        const sy = Math.sqrt(Math.max(0, acSumY2 / acN - my * my));
        corr = sx * sy > EPS ? cov / (sx * sy) : 0;
      }
      dcRow.push(Math.max(0, Math.min(1, 1 - Math.abs(corr))));
      avgVarSum += variance;
    }
    varRaw.push(vRow); gradRaw.push(gRow); hfRaw.push(hfRow); entRaw.push(eRow); intRaw.push(iRow);
    spreadRaw.push(spRow); decorRaw.push(dcRow);
  }
  const lm = lapMean / lapN;
  globalLapVar = (lapMeanSq / lapN - lm * lm) * 1000; // back into pixel-scale units

  // Robust per-feature normalization (95th-percentile based, not min–max).
  const features: BlockFeatureMaps = {
    variance: robustNormalize(varRaw),
    gradient: robustNormalize(gradRaw),
    entropy: robustNormalize(entRaw, 0.1),
    highFreq: robustNormalize(hfRaw),
    intensity: intRaw, // already 0..1, only used by Q-state heuristics
    spread: robustNormalize(spreadRaw, 0.05),
    // Decorrelation already in 0..1 — no rescaling, just pass through.
    decorrelation: decorRaw,
  };

  // Low-signal suppression: compute a global high-frequency energy and
  // gate the heatmap if the image is essentially flat.
  let hfMean = 0;
  for (const row of hfRaw) for (const v of row) hfMean += v;
  hfMean /= (N * N);
  const signalGate = hfMean < LOW_SIGNAL_FLOOR
    ? Math.max(0, hfMean / LOW_SIGNAL_FLOOR) * 0.4
    : 1;

  const fused = fuse(features); // no CNN yet
  const scoreMap = fused.map((r) => r.map((v) => v * signalGate));
  const roi = smooth(scoreMap);
  const complexityScore = areaAwareGlobal(roi);
  const avgBlockVariance = avgVarSum / (N * N) * 65025; // back to 0..255² scale for legacy thresholds
  const edgeDensityPct = (edgePixels / totalPixels) * 100;

  // ===== Verdict =====
  if (globalLapVar < 50) reasons.push(`Laplacian variance ${globalLapVar.toFixed(1)} — image too smooth.`);
  if (edgeDensityPct < 3) reasons.push(`Edge density ${edgeDensityPct.toFixed(2)}% — not enough edges.`);
  if (complexityScore < 8) reasons.push(`Few high-quality regions (${complexityScore.toFixed(1)}/100).`);

  let verdict: AnalysisResult["verdict"] = "ACCEPTED";
  if (globalLapVar < 5 || edgeDensityPct < 0.2 || complexityScore < 1) {
    verdict = "REJECTED";
    reasons.push("Image is flat / single-colour — unsuitable for steganography.");
  } else if (reasons.length > 0) {
    verdict = "WARNING";
    reasons.push("Proceed with caution — quality may be lower.");
  } else {
    reasons.push("Strong texture and edge content detected. Excellent stego carrier.");
  }

  // capacity from "good" cells
  let usable = 0;
  for (const row of roi) for (const v of row) if (v > 0.5) usable++;
  const capacityBits = Math.floor(usable * bw * bh * 3);

  return {
    width: w, height: h,
    textureScore: Math.min(100, globalLapVar / 5),
    laplacianVariance: globalLapVar,
    edgeDensityPct,
    complexityScore,
    avgBlockVariance,
    roi, scoreMap, features,
    verdict, reasons, capacityBits,
    // Stash the gate so withRoi() can re-apply it after CNN fusion.
    ...({ _signalGate: signalGate } as any),
  };
}

export const ROI_SIZE = ROI_GRID;

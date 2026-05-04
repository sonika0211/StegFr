/**
 * Calibrated, region-aware image analysis for stego suitability.
 *
 * For each block in a 32×32 grid we compute FIVE handcrafted features
 * (variance, gradient magnitude, entropy, high-frequency energy, intensity)
 * AT FULL RESOLUTION and then fuse them into a single per-block score:
 *
 *   score_raw = 0.30·var + 0.25·grad + 0.20·entropy + 0.15·hf + 0.10·cnn
 *   score     = clip(score_raw − 0.25·|2I−1|, 0, 1)
 *
 * Each feature is min-max normalized INDEPENDENTLY (with ε) to avoid the
 * "everything ≈ 100" saturation problem. The final heatmap is calibrated
 * with z-score → sigmoid so good vs bad regions are visually distinct.
 *
 * The global score is area-aware: only pixels with heatmap > 0.6 contribute.
 */

export interface BlockFeatureMaps {
  variance: number[][];
  gradient: number[][];
  entropy: number[][];
  highFreq: number[][];
  intensity: number[][];
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

/* ---------------- helpers ---------------- */

function normalize(map: number[][]): number[][] {
  let lo = Infinity, hi = -Infinity;
  for (const row of map) for (const v of row) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = Math.max(EPS, hi - lo);
  return map.map((r) => r.map((v) => (v - lo) / span));
}

function sigmoid(x: number) { return 1 / (1 + Math.exp(-x)); }

/** Calibrate a fused score map with z-score → sigmoid (×3 contrast). */
function calibrateHeatmap(score: number[][]): number[][] {
  let s = 0, s2 = 0, n = 0;
  for (const row of score) for (const v of row) { s += v; s2 += v * v; n++; }
  const mean = s / n;
  const std = Math.sqrt(Math.max(EPS, s2 / n - mean * mean));
  return score.map((r) => r.map((v) => sigmoid(((v - mean) / std) * 1.5)));
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

const W_VAR = 0.30, W_GRAD = 0.25, W_ENT = 0.20, W_HF = 0.15, W_CNN = 0.10;
const W_BRIGHT = 0.25;

function fuse(features: BlockFeatureMaps, cnn?: number[][]): number[][] {
  const N = features.variance.length;
  const out: number[][] = [];
  for (let y = 0; y < N; y++) {
    const row: number[] = [];
    for (let x = 0; x < N; x++) {
      const cnnV = cnn ? cnn[y][x] : 0;
      const cnnW = cnn ? W_CNN : 0;
      // redistribute cnn weight if absent
      const norm = cnn ? 1 : 1 - W_CNN;
      const raw = (
        W_VAR * features.variance[y][x] +
        W_GRAD * features.gradient[y][x] +
        W_ENT * features.entropy[y][x] +
        W_HF * features.highFreq[y][x] +
        cnnW * cnnV
      ) / norm;
      const brightnessPenalty = Math.abs(features.intensity[y][x] - 0.5) * 2;
      const s = Math.max(0, Math.min(1, raw - W_BRIGHT * brightnessPenalty));
      row.push(s);
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
  const cnnNorm = normalize(cnn);
  const scoreMap = fuse(base.features, cnnNorm);
  const roi = calibrateHeatmap(scoreMap);

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
      features: { variance: empty, gradient: empty, entropy: empty, highFreq: empty, intensity: empty },
      verdict: "REJECTED", reasons: ["Image is too small (min 32×32)."], capacityBits: 0,
    };
  }

  const g = toGray(data, w, h);
  const { grad, lap } = fullResDerivatives(g, w, h);

  // Per-block raw features
  const N = ROI_GRID;
  const bw = w / N, bh = h / N;
  const varRaw: number[][] = [], gradRaw: number[][] = [], hfRaw: number[][] = [], entRaw: number[][] = [], intRaw: number[][] = [];

  let globalLapVar = 0, lapMean = 0, lapMeanSq = 0, lapN = 0;
  let edgePixels = 0, totalPixels = 0;
  let avgVarSum = 0;

  for (let by = 0; by < N; by++) {
    const vRow: number[] = [], gRow: number[] = [], hfRow: number[] = [], eRow: number[] = [], iRow: number[] = [];
    for (let bx = 0; bx < N; bx++) {
      const x0 = Math.floor(bx * bw), y0 = Math.floor(by * bh);
      const x1 = Math.min(w, Math.floor((bx + 1) * bw));
      const y1 = Math.min(h, Math.floor((by + 1) * bh));
      let sumI = 0, sumI2 = 0, sumG = 0, sumL = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * w + x;
          const I = g[i];
          sumI += I; sumI2 += I * I;
          sumG += grad[i];
          sumL += lap[i];
          n++;
          if (grad[i] > 0.25) edgePixels++;
          totalPixels++;
          lapMean += lap[i]; lapMeanSq += lap[i] * lap[i]; lapN++;
        }
      }
      const meanI = sumI / n;
      const variance = sumI2 / n - meanI * meanI;
      vRow.push(variance);
      gRow.push(sumG / n);
      hfRow.push(sumL / n);
      eRow.push(blockEntropy(g, w, x0, y0, x1, y1));
      iRow.push(meanI);
      avgVarSum += variance;
    }
    varRaw.push(vRow); gradRaw.push(gRow); hfRaw.push(hfRow); entRaw.push(eRow); intRaw.push(iRow);
  }
  const lm = lapMean / lapN;
  globalLapVar = (lapMeanSq / lapN - lm * lm) * 1000; // back into pixel-scale units

  const features: BlockFeatureMaps = {
    variance: normalize(varRaw),
    gradient: normalize(gradRaw),
    entropy: normalize(entRaw),
    highFreq: normalize(hfRaw),
    intensity: intRaw, // already 0..1
  };

  const scoreMap = fuse(features); // no CNN yet
  const roi = calibrateHeatmap(scoreMap);
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
  };
}

export const ROI_SIZE = ROI_GRID;

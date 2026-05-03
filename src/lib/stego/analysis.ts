/**
 * Image analysis for stego suitability.
 * Computes Laplacian variance (texture), Sobel edge density, and a 32x32
 * block-wise complexity grid that doubles as the ROI heatmap.
 *
 * STRICT validation — pure / blank / flat images MUST be rejected so we
 * never produce false positives.
 */

export interface AnalysisResult {
  width: number;
  height: number;
  textureScore: number;          // 0..100
  laplacianVariance: number;
  edgeDensityPct: number;        // 0..100
  complexityScore: number;       // 0..100 (avg block variance, scaled)
  avgBlockVariance: number;
  /** 32x32 weights, 0..1, higher = better hiding */
  roi: number[][];
  verdict: "ACCEPTED" | "REJECTED" | "WARNING";
  reasons: string[];
  /** Total bits available across all blocks (1 LSB per channel, blocks weighted) */
  capacityBits: number;
}

const ROI_GRID = 32;

/** Replace the heuristic ROI in an existing AnalysisResult with a CNN-predicted one. */
export function withRoi(base: AnalysisResult, roi: number[][]): AnalysisResult {
  // recompute capacity using the new ROI (supports any NxN grid)
  const N = roi.length;
  const flat = roi.flat().sort((a, b) => b - a);
  const cutoff = flat[Math.floor(flat.length * 0.5)] || 0;
  let usableBlocks = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (roi[y][x] >= cutoff) usableBlocks++;
  const pixelsPerBlock = (base.width / N) * (base.height / N);
  const capacityBits = Math.floor(usableBlocks * pixelsPerBlock * 3);
  return { ...base, roi, capacityBits };
}

function toGray(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    g[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return g;
}

/** Variance of 3x3 Laplacian — high means lots of texture / detail. */
function laplacianVariance(g: Float32Array, w: number, h: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v =
        -g[i - w - 1] - g[i - w] - g[i - w + 1] -
        g[i - 1] + 8 * g[i] - g[i + 1] -
        g[i + w - 1] - g[i + w] - g[i + w + 1];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Sobel edge density (% of pixels above threshold). */
function edgeDensity(g: Float32Array, w: number, h: number): { pct: number; map: Uint8Array } {
  const map = new Uint8Array(w * h);
  let edges = 0;
  const T = 60;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -g[i - w - 1] + g[i - w + 1] -
        2 * g[i - 1] + 2 * g[i + 1] -
        g[i + w - 1] + g[i + w + 1];
      const gy =
        -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] +
        g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
      const m = Math.sqrt(gx * gx + gy * gy);
      if (m > T) {
        edges++;
        map[i] = 255;
      }
    }
  }
  return { pct: (edges / (w * h)) * 100, map };
}

/**
 * Analyze an ImageData. Returns metrics + ROI heatmap + verdict.
 */
export function analyzeImage(img: ImageData): AnalysisResult {
  const { width: w, height: h, data } = img;
  const reasons: string[] = [];

  if (w < 32 || h < 32) {
    return {
      width: w,
      height: h,
      textureScore: 0,
      laplacianVariance: 0,
      edgeDensityPct: 0,
      complexityScore: 0,
      avgBlockVariance: 0,
      roi: Array.from({ length: ROI_GRID }, () => Array(ROI_GRID).fill(0)),
      verdict: "REJECTED",
      reasons: ["Image is too small (min 32×32)."],
      capacityBits: 0,
    };
  }

  const g = toGray(data, w, h);
  const lapVar = laplacianVariance(g, w, h);
  const { pct: edgePct } = edgeDensity(g, w, h);

  // 32x32 grid — block sizes derived from image dims.
  const bw = w / ROI_GRID;
  const bh = h / ROI_GRID;
  const variances: number[][] = Array.from({ length: ROI_GRID }, () => Array(ROI_GRID).fill(0));
  let sumVar = 0;

  for (let by = 0; by < ROI_GRID; by++) {
    for (let bx = 0; bx < ROI_GRID; bx++) {
      const x0 = Math.floor(bx * bw);
      const y0 = Math.floor(by * bh);
      const x1 = Math.min(w, Math.floor((bx + 1) * bw));
      const y1 = Math.min(h, Math.floor((by + 1) * bh));
      let sum = 0;
      let sumSq = 0;
      let n = 0;
      let edgesInBlock = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const v = g[y * w + x];
          sum += v;
          sumSq += v * v;
          n++;
          // cheap edge proxy (already counted globally; reuse for ROI weight)
          if (x > 0 && y > 0) {
            const dx = v - g[y * w + (x - 1)];
            const dy = v - g[(y - 1) * w + x];
            if (dx * dx + dy * dy > 1500) edgesInBlock++;
          }
        }
      }
      const mean = sum / n;
      const variance = sumSq / n - mean * mean;
      const localEdge = edgesInBlock / n; // 0..1
      // weighted ROI score: edges 0.5, texture 0.3, complexity 0.2
      const tex = Math.min(1, variance / 800);
      const cmp = Math.min(1, variance / 1500);
      const score = localEdge * 0.5 + tex * 0.3 + cmp * 0.2;
      variances[by][bx] = score;
      sumVar += variance;
    }
  }

  const avgBlockVariance = sumVar / (ROI_GRID * ROI_GRID);

  // Normalize ROI to 0..1
  let maxScore = 0;
  for (let y = 0; y < ROI_GRID; y++) for (let x = 0; x < ROI_GRID; x++) maxScore = Math.max(maxScore, variances[y][x]);
  const roi = variances.map((row) => row.map((v) => (maxScore > 0 ? v / maxScore : 0)));

  // ===== Validation (strict) =====
  if (lapVar < 150) reasons.push(`Laplacian variance ${lapVar.toFixed(1)} < 150 — image too smooth.`);
  if (edgePct < 3) reasons.push(`Edge density ${edgePct.toFixed(2)}% < 3% — not enough edges.`);
  if (avgBlockVariance < 50) reasons.push(`Average block variance ${avgBlockVariance.toFixed(1)} < 50 — flat regions dominate.`);

  let verdict: AnalysisResult["verdict"] = "ACCEPTED";
  // Hard reject: image is essentially flat / blank / single-colour.
  if (lapVar < 5 || avgBlockVariance < 5 || edgePct < 0.2) {
    verdict = "REJECTED";
    reasons.push("Image is flat / single-colour — unsuitable for steganography.");
  } else if (reasons.length > 0) {
    verdict = "WARNING";
    reasons.push("Image is not ideal — proceed with caution. Quality may be lower.");
  } else if (lapVar < 400 || edgePct < 6 || avgBlockVariance < 150) {
    verdict = "WARNING";
    reasons.push("Image is acceptable but borderline — payload size should be conservative.");
  } else {
    reasons.push("Strong texture and edge content detected. Excellent stego carrier.");
  }

  // Capacity: top ~50% of blocks usable, 3 bits per pixel (RGB LSB)
  const flat = roi.flat().sort((a, b) => b - a);
  const cutoff = flat[Math.floor(flat.length * 0.5)] || 0;
  let usableBlocks = 0;
  for (let y = 0; y < ROI_GRID; y++) for (let x = 0; x < ROI_GRID; x++) if (roi[y][x] >= cutoff) usableBlocks++;
  const pixelsPerBlock = bw * bh;
  const capacityBits = Math.floor(usableBlocks * pixelsPerBlock * 3);

  return {
    width: w,
    height: h,
    textureScore: Math.min(100, lapVar / 30),
    laplacianVariance: lapVar,
    edgeDensityPct: edgePct,
    complexityScore: Math.min(100, avgBlockVariance / 8),
    avgBlockVariance,
    roi,
    verdict,
    reasons,
    capacityBits,
  };
}

export const ROI_SIZE = ROI_GRID;
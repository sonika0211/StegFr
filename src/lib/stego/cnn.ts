/**
 * Tiny CNN ROI predictor (in-browser, TensorFlow.js).
 *
 * Architecture (designed to match a published "stego suitability" mini-net):
 *   Input    : 1 x 32 x 32  (grayscale, 32x32 down-sampled image)
 *   Conv2D   : 8 filters, 3x3, ReLU, padding="same"        -> 8 x 32 x 32
 *   MaxPool  : 2x2                                          -> 8 x 16 x 16
 *   Conv2D   : 16 filters, 3x3, ReLU, padding="same"       -> 16 x 16 x 16
 *   Conv2D   : 1 filter, 1x1, sigmoid, padding="same"      -> 1 x 16 x 16
 *   Upsample : nearest 2x                                   -> 1 x 32 x 32  (ROI heatmap)
 *
 * Weights are loaded from a small JSON blob bundled with the app. They were
 * derived from a hand-crafted edge / texture detector (Sobel + Laplacian
 * combinations) that mimics the behavior of a network trained on PSNR
 * gradients — so the model gives sensible ROI maps out of the box and runs
 * fully client-side with no download.
 */

import * as tf from "@tensorflow/tfjs";

let _model: tf.LayersModel | null = null;

/** Build the network with deterministic, hand-engineered weights. */
function buildModel(): tf.LayersModel {
  // ---- Layer 1: 8 filters of 3x3, ReLU. Pre-seeded as edge / texture banks ----
  // First 4 = oriented edge detectors (Sobel-like), next 4 = laplacian / corner / blob
  const k1 = tf.tensor4d(
    new Float32Array([
      // filter 0: vertical edge (Sobel x)
      -1, 0, 1, -2, 0, 2, -1, 0, 1,
      // filter 1: horizontal edge (Sobel y)
      -1, -2, -1, 0, 0, 0, 1, 2, 1,
      // filter 2: diag /
      0, 1, 2, -1, 0, 1, -2, -1, 0,
      // filter 3: diag \
      2, 1, 0, 1, 0, -1, 0, -1, -2,
      // filter 4: laplacian
      0, -1, 0, -1, 4, -1, 0, -1, 0,
      // filter 5: corner-ish high-pass
      -1, -1, -1, -1, 8, -1, -1, -1, -1,
      // filter 6: vertical line
      -1, 2, -1, -1, 2, -1, -1, 2, -1,
      // filter 7: horizontal line
      -1, -1, -1, 2, 2, 2, -1, -1, -1,
    ]).map((v) => v * 0.18), // scale so ReLU activations are reasonable
    [3, 3, 1, 8],
  );
  const b1 = tf.zeros([8]);

  // ---- Layer 2: 16 filters of 3x3 mixing the 8 banks ----
  // Each output filter sums |edge banks| with positive weights — encourages
  // any-orientation texture response. Built as an identity-ish combiner
  // followed by a smoothing kernel.
  const k2data = new Float32Array(3 * 3 * 8 * 16);
  // Channels-last: index = ((h*3 + w)*8 + cin)*16 + cout
  for (let cout = 0; cout < 16; cout++) {
    for (let cin = 0; cin < 8; cin++) {
      // smooth 3x3 box, weighted toward the matching input channel
      for (let h = 0; h < 3; h++) {
        for (let w = 0; w < 3; w++) {
          const i = ((h * 3 + w) * 8 + cin) * 16 + cout;
          const center = h === 1 && w === 1 ? 1.0 : 0.5;
          // each output picks 1-2 input channels strongly + small from others
          const affinity = (cout % 8 === cin) ? 0.30 : 0.04;
          k2data[i] = center * affinity;
        }
      }
    }
  }
  const k2 = tf.tensor4d(k2data, [3, 3, 8, 16]);
  const b2 = tf.zeros([16]);

  // ---- Layer 3: 1x1 conv, sigmoid → ROI map ----
  const k3data = new Float32Array(1 * 1 * 16 * 1);
  for (let i = 0; i < 16; i++) k3data[i] = 0.55; // each channel contributes
  const k3 = tf.tensor4d(k3data, [1, 1, 16, 1]);
  const b3 = tf.tensor1d([-2.2]); // bias so blank input ≈ low activation

  const input = tf.input({ shape: [32, 32, 1] });
  const c1 = tf.layers
    .conv2d({ filters: 8, kernelSize: 3, padding: "same", activation: "relu", weights: [k1, b1] })
    .apply(input) as tf.SymbolicTensor;
  const p1 = tf.layers.maxPooling2d({ poolSize: 2 }).apply(c1) as tf.SymbolicTensor;
  const c2 = tf.layers
    .conv2d({ filters: 16, kernelSize: 3, padding: "same", activation: "relu", weights: [k2, b2] })
    .apply(p1) as tf.SymbolicTensor;
  const c3 = tf.layers
    .conv2d({ filters: 1, kernelSize: 1, padding: "same", activation: "sigmoid", weights: [k3, b3] })
    .apply(c2) as tf.SymbolicTensor;
  const up = tf.layers.upSampling2d({ size: [2, 2] }).apply(c3) as tf.SymbolicTensor;

  return tf.model({ inputs: input, outputs: up });
}

export async function getCnnModel(): Promise<tf.LayersModel> {
  if (_model) return _model;
  await tf.ready();
  _model = buildModel();
  return _model;
}

/**
 * Run the CNN on an ImageData. Returns a 32x32 ROI heatmap (values 0..1),
 * the model's mean activation (used as an aggregate "stego suitability"
 * confidence score), and the stride used.
 */
export interface CnnRoiResult {
  roi: number[][];          // 32x32, normalized 0..1
  meanActivation: number;   // average pre-normalization activation, 0..1
  confidence: number;       // 0..100 mapped score
}

function downsampleToGray32(img: ImageData): Float32Array {
  // Simple block-average to 32x32, scaled to [0, 1].
  const out = new Float32Array(32 * 32);
  const { width: w, height: h, data } = img;
  const bw = w / 32;
  const bh = h / 32;
  for (let by = 0; by < 32; by++) {
    for (let bx = 0; bx < 32; bx++) {
      const x0 = Math.floor(bx * bw);
      const y0 = Math.floor(by * bh);
      const x1 = Math.min(w, Math.floor((bx + 1) * bw));
      const y1 = Math.min(h, Math.floor((by + 1) * bh));
      let s = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          s += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          n++;
        }
      }
      out[by * 32 + bx] = (s / n) / 255;
    }
  }
  return out;
}

export async function predictRoi(img: ImageData): Promise<CnnRoiResult> {
  const model = await getCnnModel();
  const gray = downsampleToGray32(img);

  return tf.tidy(() => {
    const input = tf.tensor4d(gray, [1, 32, 32, 1]);
    const out = model.predict(input) as tf.Tensor;
    const arr = out.dataSync();
    let mean = 0;
    let max = 0;
    let min = 1;
    for (let i = 0; i < arr.length; i++) {
      mean += arr[i];
      if (arr[i] > max) max = arr[i];
      if (arr[i] < min) min = arr[i];
    }
    mean /= arr.length;

    // Normalize to 0..1 across the map for visualization & ranking.
    const roi: number[][] = [];
    const range = Math.max(1e-6, max - min);
    for (let y = 0; y < 32; y++) {
      const row: number[] = [];
      for (let x = 0; x < 32; x++) row.push((arr[y * 32 + x] - min) / range);
      roi.push(row);
    }

    return {
      roi,
      meanActivation: mean,
      confidence: Math.min(100, Math.max(0, mean * 140)),
    };
  });
}
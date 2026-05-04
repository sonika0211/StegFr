/**
 * Tabular Q-learning agent persisted in Lovable Cloud (qtable).
 *
 * UPGRADED:
 *   • Full Bellman update with discount γ:
 *       Q(s,a) ← Q(s,a) + α · ( r + γ · max_a' Q(s', a') − Q(s,a) )
 *   • ε-greedy with decaying exploration (persisted across calls).
 *   • Composite reward: PSNR + capacity-used − low-texture penalty.
 *   • Offline training loop (`trainOffline`) that simulates 500–2000
 *     embedding episodes against synthetic image features.
 *
 * State (discretised so the table stays tiny):
 *   texture (0..2), edge (0..2), cnn (0..2), length (0..2)
 * Actions: density × priority (3×3 = 9).
 */

import { supabase } from "@/integrations/supabase/client";

export type Density = "low" | "medium" | "high";
export type Priority = "edges" | "texture" | "mixed";

export interface QState {
  texture: 0 | 1 | 2;
  edge: 0 | 1 | 2;
  cnn: 0 | 1 | 2;
  length: 0 | 1 | 2;
}
export interface QAction { density: Density; priority: Priority }

const DENSITIES: Density[] = ["low", "medium", "high"];
const PRIORITIES: Priority[] = ["edges", "texture", "mixed"];

// --- Hyperparameters ---
const ALPHA = 0.20;            // learning rate
const GAMMA = 0.90;            // discount factor
const EPSILON_MIN = 0.01;
const EPSILON_DECAY = 0.995;

// epsilon persisted in localStorage so decay carries across page loads
function getEpsilon(): number {
  try {
    const v = parseFloat(localStorage.getItem("qlearn.epsilon") || "0.25");
    return isFinite(v) ? Math.max(EPSILON_MIN, v) : 0.25;
  } catch { return 0.25; }
}
function setEpsilon(v: number) {
  try { localStorage.setItem("qlearn.epsilon", String(Math.max(EPSILON_MIN, v))); } catch {}
}
function decayEpsilon() { setEpsilon(getEpsilon() * EPSILON_DECAY); }

export function stateKey(s: QState): string {
  return `t${s.texture}e${s.edge}c${s.cnn}l${s.length}`;
}
export function actionKey(a: QAction): string {
  return `${a.density}-${a.priority}`;
}
function parseAction(k: string): QAction {
  const [d, p] = k.split("-");
  return { density: d as Density, priority: p as Priority };
}

export function discretise(
  laplacianVariance: number,
  edgeDensityPct: number,
  cnnConfidence: number,  // 0..100
  msgLength: number,
): QState {
  const t = (laplacianVariance > 800 ? 2 : laplacianVariance > 300 ? 1 : 0) as 0 | 1 | 2;
  const e = (edgeDensityPct > 12 ? 2 : edgeDensityPct > 6 ? 1 : 0) as 0 | 1 | 2;
  const c = (cnnConfidence > 65 ? 2 : cnnConfidence > 35 ? 1 : 0) as 0 | 1 | 2;
  const l = (msgLength > 500 ? 2 : msgLength > 100 ? 1 : 0) as 0 | 1 | 2;
  return { texture: t, edge: e, cnn: c, length: l };
}

/* ---------------- reward ---------------- */

export interface RewardContext {
  psnr: number;
  capacityUsed: number;        // 0..1 (bits used / capacity)
  lowTextureFraction: number;  // 0..1 (fraction of touched blocks that were smooth)
}

/** Composite reward: PSNR + capacity utilisation − smooth-region penalty. */
export function compositeReward(ctx: RewardContext): number {
  // Asymmetric PSNR shaping — strongly punish PSNR < 40 dB, gently
  // reward > 50 dB so the agent doesn't over-prioritise quality at the
  // expense of using capacity.
  const psnrNorm = ctx.psnr >= 45
    ? Math.min(1, (ctx.psnr - 45) / 15)
    : -Math.min(2, (45 - ctx.psnr) / 8); // sharp drop below 45 dB
  const w1 = 6, w2 = 1.5, w3 = 6;        // smooth-region penalty bumped 4 → 6
  return w1 * psnrNorm + w2 * ctx.capacityUsed - w3 * ctx.lowTextureFraction;
}

/** Legacy shim: PSNR-only reward (used by old call sites). */
export function rewardFromPsnr(psnr: number): number {
  return compositeReward({ psnr, capacityUsed: 0.5, lowTextureFraction: 0.1 });
}

/* ---------------- Q-table I/O ---------------- */

interface QRow { action_key: string; q_value: number; visits: number }

async function fetchStateRows(sk: string): Promise<QRow[]> {
  const { data, error } = await (supabase as any)
    .from("qtable")
    .select("action_key,q_value,visits")
    .eq("state_key", sk);
  if (error || !data) return [];
  return data as QRow[];
}

function buildCandidates(rows: QRow[]) {
  const out: { action: QAction; qValue: number; visits: number }[] = [];
  for (const d of DENSITIES) for (const p of PRIORITIES) {
    const a = { density: d, priority: p };
    const r = rows.find((x) => x.action_key === actionKey(a));
    out.push({ action: a, qValue: r?.q_value ?? 0, visits: r?.visits ?? 0 });
  }
  return out;
}

export async function maxQForState(state: QState): Promise<number> {
  const rows = await fetchStateRows(stateKey(state));
  if (!rows.length) return 0;
  return rows.reduce((m, r) => Math.max(m, r.q_value), 0);
}

/* ---------------- action selection ---------------- */

export interface QChoice {
  action: QAction;
  qValue: number;
  explored: boolean;
  epsilon: number;
  candidates: { action: QAction; qValue: number; visits: number }[];
}

export async function chooseQAction(state: QState, msgLength: number): Promise<QChoice> {
  const rows = await fetchStateRows(stateKey(state));
  const candidates = buildCandidates(rows);

  const epsilon = getEpsilon();
  const explore = Math.random() < epsilon;

  let chosen: { action: QAction; qValue: number; visits: number };
  if (explore) {
    chosen = candidates[Math.floor(Math.random() * candidates.length)];
  } else {
    const allZero = candidates.every((c) => c.qValue === 0);
    if (allZero) {
      const prior = heuristicPrior(state, msgLength);
      chosen = candidates.find((x) => actionKey(x.action) === actionKey(prior))!;
    } else {
      chosen = candidates.reduce((best, c) => (c.qValue > best.qValue ? c : best));
    }
  }
  decayEpsilon();
  return { action: chosen.action, qValue: chosen.qValue, explored: explore, epsilon, candidates };
}

function heuristicPrior(state: QState, _msg: number): QAction {
  const density: Density = state.length === 2 ? "high" : state.length === 1 ? "medium" : "low";
  let priority: Priority = "mixed";
  if (state.cnn === 2 && state.texture >= 1) priority = "texture";
  else if (state.edge === 2) priority = "edges";
  return { density, priority };
}

/* ---------------- Q update (Bellman) ---------------- */

/**
 * Full Q-learning update with discount γ and next-state lookahead.
 *   Q(s,a) ← Q + α (r + γ max_a' Q(s', a') − Q)
 */
export async function updateQ(
  state: QState,
  action: QAction,
  reward: number,
  prevQ: number,
  nextState?: QState,
): Promise<number> {
  const sk = stateKey(state);
  const ak = actionKey(action);
  const futureMax = nextState ? await maxQForState(nextState) : 0;
  const target = reward + GAMMA * futureMax;
  const newQ = prevQ + ALPHA * (target - prevQ);

  const { data: existing } = await (supabase as any)
    .from("qtable")
    .select("id,visits")
    .eq("state_key", sk)
    .eq("action_key", ak)
    .maybeSingle();

  if (existing?.id) {
    await (supabase as any)
      .from("qtable")
      .update({ q_value: newQ, visits: (existing.visits ?? 0) + 1, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await (supabase as any)
      .from("qtable")
      .insert({ state_key: sk, action_key: ak, q_value: newQ, visits: 1 });
  }
  return newQ;
}

/* ---------------- offline training ---------------- */

/**
 * Simulate an embedding episode purely in code so the agent can pre-train
 * without needing a real image. Returns approximate (psnr, capacityUsed,
 * lowTextureFraction) for the chosen action against the simulated state.
 */
function simulateEpisode(state: QState, action: QAction): RewardContext {
  // baseline PSNR drops with density and rises with texture/edge.
  const densityFactor = action.density === "low" ? 0.2 : action.density === "medium" ? 0.5 : 0.9;
  const textureBoost = state.texture * 2 + state.edge * 1.5 + state.cnn * 1.0; // 0..9
  // priority match bonus
  let match = 0;
  if (action.priority === "edges" && state.edge >= 1) match += 1.5;
  if (action.priority === "texture" && state.texture >= 1) match += 1.5;
  if (action.priority === "mixed") match += 0.8;

  const psnr = 60 - densityFactor * 18 + textureBoost * 0.6 + match - Math.random() * 2;
  const capacityUsed = densityFactor * (0.5 + Math.random() * 0.4);
  const smooth = state.texture === 0 && state.edge === 0 ? 0.6 : Math.max(0, 0.3 - state.texture * 0.1);
  const lowTextureFraction = Math.min(1, smooth + Math.random() * 0.1);
  return { psnr, capacityUsed, lowTextureFraction };
}

export interface TrainProgress { episode: number; total: number; avgReward: number; epsilon: number }

/**
 * Run N offline episodes that update the persisted Q-table. Each "episode"
 * is a single (s,a,r,s') transition where s' is a small random perturbation
 * of s — enough to make the discount factor matter.
 */
export async function trainOffline(
  episodes = 800,
  onProgress?: (p: TrainProgress) => void,
): Promise<{ episodes: number; avgReward: number }> {
  let rewardSum = 0;
  for (let i = 0; i < episodes; i++) {
    const state: QState = {
      texture: (Math.floor(Math.random() * 3)) as 0 | 1 | 2,
      edge: (Math.floor(Math.random() * 3)) as 0 | 1 | 2,
      cnn: (Math.floor(Math.random() * 3)) as 0 | 1 | 2,
      length: (Math.floor(Math.random() * 3)) as 0 | 1 | 2,
    };
    const choice = await chooseQAction(state, 200);
    const sim = simulateEpisode(state, choice.action);
    const reward = compositeReward(sim);
    rewardSum += reward;

    // next state — tweak one bin to model "after embedding" change
    const nextState: QState = { ...state, length: Math.max(0, state.length - 1) as 0 | 1 | 2 };
    await updateQ(state, choice.action, reward, choice.qValue, nextState);

    if (onProgress && (i % 25 === 0 || i === episodes - 1)) {
      onProgress({ episode: i + 1, total: episodes, avgReward: rewardSum / (i + 1), epsilon: getEpsilon() });
    }
  }
  return { episodes, avgReward: rewardSum / episodes };
}

export { DENSITIES, PRIORITIES, parseAction, getEpsilon };

/**
 * Tabular Q-learning agent persisted in Lovable Cloud (qtable table).
 *
 * State (discretised so the table stays tiny):
 *   - texture bin   : 0..2  (low / med / high Laplacian variance)
 *   - edge bin      : 0..2  (edge density)
 *   - cnn bin       : 0..2  (CNN mean activation)
 *   - length bin    : 0..2  (message length)
 *
 * Actions: cartesian product of
 *   - density   : low | medium | high
 *   - priority  : edges | texture | mixed
 *
 * Update rule (per the standard Q-learning equation, single-step episode so
 * the discounted future return collapses to just the immediate reward):
 *
 *   Q(s,a) ← Q(s,a) + α · ( r − Q(s,a) )
 *
 * Reward: derived from PSNR after embedding (higher is better).
 * Action selection: ε-greedy with ε=0.10.
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
const ALPHA = 0.25;
const EPSILON = 0.10;

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

/** PSNR → reward shaping. Tuned so the agent strongly prefers ≥50 dB. */
export function rewardFromPsnr(psnr: number): number {
  if (!isFinite(psnr)) return -5;
  if (psnr >= 60) return 10;
  if (psnr >= 55) return 6;
  if (psnr >= 50) return 3;
  if (psnr >= 45) return 0;
  return -3;
}

export interface QChoice {
  action: QAction;
  qValue: number;
  explored: boolean;          // true if ε-greedy chose to explore
  candidates: { action: QAction; qValue: number; visits: number }[];
}

/**
 * Pick the best action for `state`. Reads all rows for that state from the
 * Q-table; falls back to a sensible default when unseen (so the agent works
 * on day one). With probability ε, picks a random action to keep exploring.
 */
export async function chooseQAction(state: QState, msgLength: number): Promise<QChoice> {
  const sk = stateKey(state);
  const { data, error } = await (supabase as any)
    .from("qtable")
    .select("action_key,q_value,visits")
    .eq("state_key", sk);

  const rows: { action_key: string; q_value: number; visits: number }[] = error || !data ? [] : data;

  // Build a candidates table covering all actions (default Q=0)
  const candidates: { action: QAction; qValue: number; visits: number }[] = [];
  for (const d of DENSITIES) {
    for (const p of PRIORITIES) {
      const a = { density: d, priority: p };
      const r = rows.find((x) => x.action_key === actionKey(a));
      candidates.push({ action: a, qValue: r?.q_value ?? 0, visits: r?.visits ?? 0 });
    }
  }

  // ε-greedy: explore with probability EPSILON
  const explore = Math.random() < EPSILON;
  let chosen: { action: QAction; qValue: number; visits: number };
  if (explore) {
    chosen = candidates[Math.floor(Math.random() * candidates.length)];
  } else {
    // Greedy: highest Q. If all zeros (cold start), pick a heuristic prior.
    const allZero = candidates.every((c) => c.qValue === 0);
    if (allZero) {
      const prior = heuristicPrior(state, msgLength);
      const c = candidates.find((x) => actionKey(x.action) === actionKey(prior))!;
      chosen = c;
    } else {
      chosen = candidates.reduce((best, c) => (c.qValue > best.qValue ? c : best));
    }
  }

  return { action: chosen.action, qValue: chosen.qValue, explored: explore, candidates };
}

/** Cold-start heuristic so the agent makes a reasonable first move. */
function heuristicPrior(state: QState, msgLength: number): QAction {
  const density: Density = state.length === 2 ? "high" : state.length === 1 ? "medium" : "low";
  let priority: Priority = "mixed";
  if (state.cnn === 2 && state.texture >= 1) priority = "texture";
  else if (state.edge === 0) priority = "mixed";
  else if (state.edge === 2) priority = "edges";
  return { density, priority };
}

/** Update Q(s,a) ← Q + α(r − Q) and persist. */
export async function updateQ(
  state: QState,
  action: QAction,
  reward: number,
  prevQ: number,
): Promise<number> {
  const sk = stateKey(state);
  const ak = actionKey(action);
  const newQ = prevQ + ALPHA * (reward - prevQ);

  // Look up current row to increment visits
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

export { DENSITIES, PRIORITIES, parseAction };
/**
 * Autoresearch v3 decision model.
 *
 * Sample-aware keep/discard/stop engine shared by the Pi tools:
 * - median-based distribution summaries with a coefficient of variation;
 * - exact (or deterministic Monte Carlo) one-sided permutation test on the
 *   primary metric difference;
 * - noise gate, minimum-sample guard, guardrail metrics, and stop-policy
 *   integration (budget, consecutive discards, plateau);
 * - a full evidence trail attached to every decision for the JSONL audit log.
 *
 * The Python helper `scripts/autoresearch.py` mirrors this module; the golden
 * cases in `tests/fixtures/decision-cases.json` keep both implementations in
 * lockstep.
 */

export type Direction = "lower" | "higher";
export type DecisionAction = "baseline" | "keep" | "discard" | "stop";
export type DecisionOutcome =
  | "conclusive"
  | "threshold_only"
  | "baseline"
  | "noisy"
  | "insufficient_samples"
  | "not_significant"
  | "below_threshold"
  | "guardrail_failed"
  | "simplification"
  | "invalid"
  | "stopped";

export const POLICY_VERSION = 3;

const EXACT_PERMUTATION_LIMIT = 20_000;
const MONTE_CARLO_PERMUTATIONS = 10_000;

export interface SampleStats {
  count: number;
  median: number;
  mean: number;
  stdev: number;
  cvPct: number;
  min: number;
  max: number;
}

export interface Significance {
  method: string;
  pValue: number;
  alpha: number;
  significant: boolean;
}

export interface GuardrailInput {
  name: string;
  direction: Direction;
  tolerance_pct: number;
  candidate: number;
  best: number;
}

export interface GuardrailResult {
  name: string;
  direction: Direction;
  passed: boolean;
  observed_pct: number | null;
  tolerance_pct: number;
}

export interface DecisionPolicy {
  min_effect_size_pct?: number;
  noise_floor_pct?: number;
  alpha?: number;
  min_samples?: number;
  require_significance?: boolean;
}

export interface DecisionHistory {
  consecutive_discards?: number;
  runs_since_improvement?: number;
  max_consecutive_discards?: number;
  max_runs_without_improvement?: number;
  remaining_runs?: number;
  remaining_minutes?: number;
}

export interface StopCondition {
  stopped: boolean;
  reason: string | null;
}

export interface DecisionResult {
  action: DecisionAction;
  reason: string;
  improvementPct: number | null;
  policyVersion: number;
  outcome: DecisionOutcome;
  evidence?: Record<string, unknown>;
  guardrails?: GuardrailResult[];
}

export function median(values: number[]): number {
  if (values.length === 0) throw new Error("median requires at least one value");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function computeStats(values: number[]): SampleStats {
  if (values.length === 0) throw new Error("computeStats requires at least one sample");
  if (values.some(value => !Number.isFinite(value))) throw new Error("computeStats requires finite samples");
  const count = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / count;
  const stdev = count >= 2
    ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1))
    : 0;
  const cvPct = count >= 2 && mean !== 0 ? (stdev / Math.abs(mean)) * 100 : 0;
  return {
    count,
    median: median(values),
    mean,
    stdev,
    cvPct,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function orientedMedianDiff(candidate: number[], best: number[], direction: Direction): number {
  const diff = median(candidate) - median(best);
  return direction === "higher" ? diff : -diff;
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= kk; i++) {
    result = (result * (n - kk + i)) / i;
  }
  return Math.round(result);
}

function* combinations(n: number, k: number): Generator<number[]> {
  const indices = Array.from({ length: k }, (_, index) => index);
  while (true) {
    yield indices.slice();
    let pivot = k - 1;
    while (pivot >= 0 && indices[pivot] === pivot + n - k) pivot--;
    if (pivot < 0) return;
    indices[pivot]++;
    for (let i = pivot + 1; i < k; i++) indices[i] = indices[i - 1] + 1;
  }
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values: number[], random: () => number): void {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
}

export function permutationTestMedian(
  candidate: number[],
  best: number[],
  direction: Direction,
  alpha = 0.05,
  exactLimit = EXACT_PERMUTATION_LIMIT,
  monteCarloPermutations = MONTE_CARLO_PERMUTATIONS,
): Significance {
  if (candidate.length === 0 || best.length === 0) throw new Error("permutation test requires samples on both sides");
  if ([...candidate, ...best].some(value => !Number.isFinite(value))) throw new Error("permutation test requires finite samples");
  if (direction !== "lower" && direction !== "higher") throw new Error("direction must be 'lower' or 'higher'");

  const pooled = [...candidate, ...best];
  const candidateCount = candidate.length;
  const totalCount = pooled.length;
  const observed = orientedMedianDiff(candidate, best, direction);
  const totalCombinations = binomial(totalCount, candidateCount);

  if (totalCombinations <= exactLimit) {
    let atLeast = 0;
    let total = 0;
    for (const indices of combinations(totalCount, candidateCount)) {
      const selected = new Set(indices);
      const group = indices.map(index => pooled[index]);
      const complement = pooled.filter((_, index) => !selected.has(index));
      if (orientedMedianDiff(group, complement, direction) >= observed) atLeast++;
      total++;
    }
    return {
      method: `exact_permutation_median(${candidateCount}v${best.length}, n=${total})`,
      pValue: atLeast / total,
      alpha,
      significant: atLeast / total < alpha,
    };
  }

  const fingerprint = `${direction}|${candidate.map(value => value.toFixed(12)).join(",")}|${best.map(value => value.toFixed(12)).join(",")}`;
  const random = mulberry32(hashString(fingerprint));
  let atLeast = 0;
  for (let i = 0; i < monteCarloPermutations; i++) {
    const shuffled = [...pooled];
    shuffle(shuffled, random);
    if (orientedMedianDiff(shuffled.slice(0, candidateCount), shuffled.slice(candidateCount), direction) >= observed) {
      atLeast++;
    }
  }
  const pValue = (atLeast + 1) / (monteCarloPermutations + 1);
  return {
    method: `monte_carlo_permutation_median(${candidateCount}v${best.length}, n=${monteCarloPermutations})`,
    pValue,
    alpha,
    significant: pValue < alpha,
  };
}

export function evaluateStopPolicy(history: DecisionHistory): StopCondition {
  const consecutiveDiscards = history.consecutive_discards ?? 0;
  const runsSinceImprovement = history.runs_since_improvement ?? 0;
  const maxConsecutiveDiscards = history.max_consecutive_discards ?? 5;
  const maxRunsWithoutImprovement = history.max_runs_without_improvement ?? 10;

  if (typeof history.remaining_runs === "number" && Number.isFinite(history.remaining_runs) && history.remaining_runs <= 0) {
    return { stopped: true, reason: "run budget exhausted" };
  }
  if (typeof history.remaining_minutes === "number" && Number.isFinite(history.remaining_minutes) && history.remaining_minutes <= 0) {
    return { stopped: true, reason: "time budget exhausted" };
  }
  if (maxConsecutiveDiscards > 0 && consecutiveDiscards >= maxConsecutiveDiscards) {
    return { stopped: true, reason: `${consecutiveDiscards} consecutive discards (limit ${maxConsecutiveDiscards})` };
  }
  if (maxRunsWithoutImprovement > 0 && runsSinceImprovement >= maxRunsWithoutImprovement) {
    return {
      stopped: true,
      reason: `plateau — ${runsSinceImprovement} runs without improvement (limit ${maxRunsWithoutImprovement})`,
    };
  }
  return { stopped: false, reason: null };
}

function evaluateGuardrails(guardrails: GuardrailInput[]): { results: GuardrailResult[]; failures: string[] } {
  const results: GuardrailResult[] = [];
  const failures: string[] = [];

  for (const guardrail of guardrails) {
    const name = guardrail.name || "guardrail";
    const direction: Direction = guardrail.direction === "higher" ? "higher" : "lower";
    const tolerance = Number.isFinite(guardrail.tolerance_pct) ? guardrail.tolerance_pct : 2.0;
    const candidate = guardrail.candidate;
    const best = guardrail.best;

    if (!Number.isFinite(candidate) || !Number.isFinite(best)) {
      results.push({ name, direction, passed: false, observed_pct: null, tolerance_pct: tolerance });
      failures.push(`${name}: invalid guardrail input`);
      continue;
    }

    let observed: number;
    if (best === 0) {
      const worse = direction === "lower" ? candidate > 0 : candidate < 0;
      observed = worse ? Number.POSITIVE_INFINITY : 0;
    } else if (direction === "lower") {
      observed = ((candidate - best) / Math.abs(best)) * 100;
    } else {
      observed = ((best - candidate) / Math.abs(best)) * 100;
    }

    const passed = observed <= tolerance;
    results.push({
      name,
      direction,
      passed,
      observed_pct: Number.isFinite(observed) ? observed : null,
      tolerance_pct: tolerance,
    });
    if (!passed) {
      const rendered = Number.isFinite(observed) ? `${observed.toFixed(2)}%` : "inf";
      failures.push(`${name} regressed ${rendered} (tolerance ${tolerance.toFixed(2)}%)`);
    }
  }

  return { results, failures };
}

function relativeImprovement(direction: Direction, candidateMedian: number, bestMedian: number): number | null {
  if (bestMedian === 0) return null;
  if (direction === "lower") return ((bestMedian - candidateMedian) / Math.abs(bestMedian)) * 100;
  return ((candidateMedian - bestMedian) / Math.abs(bestMedian)) * 100;
}

function evidencePolicy(policy: {
  minEffectSizePct: number;
  noiseFloorPct: number;
  alpha: number;
  minSamples: number;
  requireSignificance: boolean;
}): Record<string, unknown> {
  return {
    policy_version: POLICY_VERSION,
    min_effect_size_pct: policy.minEffectSizePct,
    noise_floor_pct: policy.noiseFloorPct,
    alpha: policy.alpha,
    min_samples: policy.minSamples,
    require_significance: policy.requireSignificance,
  };
}

export function decideWithSamples(params: {
  candidateSamples: number[];
  bestSamples?: number[] | null;
  direction: Direction;
  policy?: DecisionPolicy;
  testsPassed?: boolean;
  guardrails?: GuardrailInput[];
  history?: DecisionHistory;
  simplification?: { removes_complexity?: boolean; behavior_unchanged?: boolean };
}): DecisionResult {
  const direction = params.direction;
  const minEffectSizePct = params.policy?.min_effect_size_pct ?? 3.0;
  const noiseFloorPct = params.policy?.noise_floor_pct ?? 0.0;
  const alpha = params.policy?.alpha ?? 0.05;
  const minSamples = params.policy?.min_samples ?? 3;
  const requireSignificance = params.policy?.require_significance ?? true;

  if (direction !== "lower" && direction !== "higher") throw new Error("direction must be 'lower' or 'higher'");
  if (!(alpha > 0 && alpha <= 1)) throw new Error("alpha must be in (0, 1]");
  if (minSamples < 2) throw new Error("min_samples must be at least 2");

  const candidateSamples = [...params.candidateSamples];
  if (candidateSamples.length === 0) {
    return { action: "discard", reason: "candidate has no samples", improvementPct: null, policyVersion: POLICY_VERSION, outcome: "invalid" };
  }
  if (candidateSamples.some(value => !Number.isFinite(value))) {
    return { action: "discard", reason: "candidate samples contain non-finite values", improvementPct: null, policyVersion: POLICY_VERSION, outcome: "invalid" };
  }
  if (params.testsPassed === false) {
    return { action: "discard", reason: "correctness checks failed", improvementPct: null, policyVersion: POLICY_VERSION, outcome: "invalid" };
  }

  if (params.history) {
    const stop = evaluateStopPolicy(params.history);
    if (stop.stopped) {
      return {
        action: "stop",
        reason: stop.reason ?? "stop policy triggered",
        improvementPct: null,
        policyVersion: POLICY_VERSION,
        outcome: "stopped",
      };
    }
  }

  const candidateStats = computeStats(candidateSamples);
  const bestSamples = params.bestSamples ? [...params.bestSamples] : [];
  if (bestSamples.some(value => !Number.isFinite(value))) {
    return { action: "discard", reason: "best samples contain non-finite values", improvementPct: null, policyVersion: POLICY_VERSION, outcome: "invalid" };
  }
  if (bestSamples.length === 0) {
    return {
      action: "baseline",
      reason: "first valid measurement becomes baseline",
      improvementPct: 0.0,
      policyVersion: POLICY_VERSION,
      outcome: "baseline",
      evidence: { candidate: candidateStats },
    };
  }

  const bestStats = computeStats(bestSamples);
  const threshold = Math.max(minEffectSizePct, noiseFloorPct);
  const evidence: Record<string, unknown> = {
    candidate: candidateStats,
    best: bestStats,
    threshold_pct: threshold,
    policy: evidencePolicy({ minEffectSizePct, noiseFloorPct, alpha, minSamples, requireSignificance }),
  };

  if (noiseFloorPct > 0 && (candidateStats.cvPct > noiseFloorPct || bestStats.cvPct > noiseFloorPct)) {
    return {
      action: "stop",
      reason: `benchmark noise exceeds floor — candidate CV ${candidateStats.cvPct.toFixed(2)}% / best CV ${bestStats.cvPct.toFixed(2)}% (floor ${noiseFloorPct.toFixed(2)}%)`,
      improvementPct: null,
      policyVersion: POLICY_VERSION,
      outcome: "noisy",
      evidence,
    };
  }

  if (candidateStats.count < minSamples || bestStats.count < minSamples) {
    return {
      action: "discard",
      reason: `insufficient samples — candidate n=${candidateStats.count}, best n=${bestStats.count} (minimum ${minSamples} per side)`,
      improvementPct: null,
      policyVersion: POLICY_VERSION,
      outcome: "insufficient_samples",
      evidence,
    };
  }

  const { results: guardrailResults, failures: guardrailFailures } = evaluateGuardrails(params.guardrails ?? []);
  if (guardrailResults.length > 0) evidence.guardrails = guardrailResults;
  if (guardrailFailures.length > 0) {
    return {
      action: "discard",
      reason: `guardrail regression: ${guardrailFailures.join("; ")}`,
      improvementPct: null,
      policyVersion: POLICY_VERSION,
      outcome: "guardrail_failed",
      evidence,
      guardrails: guardrailResults,
    };
  }

  const significance = permutationTestMedian(candidateSamples, bestSamples, direction, alpha);
  evidence.significance = {
    method: significance.method,
    p_value: significance.pValue,
    alpha: significance.alpha,
    significant: significance.significant,
  };

  const improvement = relativeImprovement(direction, candidateStats.median, bestStats.median);
  if (improvement !== null) evidence.effect_size_pct = improvement;

  const simplification = params.simplification;
  if (simplification !== undefined) {
    evidence.simplification = {
      removes_complexity: simplification.removes_complexity === true,
      behavior_unchanged: simplification.behavior_unchanged === true,
    };
  }
  if (!significance.significant && simplification?.removes_complexity === true && simplification.behavior_unchanged === true) {
    // A simplification may only keep a statistically tied candidate. A
    // significantly worse candidate must not survive via the simplification
    // branch, so test the reverse direction before keeping.
    const reverseDirection = direction === "lower" ? "higher" : "lower";
    const worse = permutationTestMedian(candidateSamples, bestSamples, reverseDirection, alpha).significant;
    if (worse) {
      return {
        action: "discard",
        reason: `simplification candidate is significantly worse (reverse p < ${alpha})`,
        improvementPct: improvement,
        policyVersion: POLICY_VERSION,
        outcome: "below_threshold",
        evidence,
      };
    }
    return {
      action: "keep",
      reason: "statistically tied result kept for simplification (complexity removed, behavior unchanged)",
      improvementPct: improvement,
      policyVersion: POLICY_VERSION,
      outcome: "simplification",
      evidence,
    };
  }

  if (bestStats.median === 0) {
    const improved = direction === "lower" ? candidateStats.median < 0 : candidateStats.median > 0;
    if (improved && significance.significant) {
      return {
        action: "keep",
        reason: "strict absolute improvement over a zero best value",
        improvementPct: null,
        policyVersion: POLICY_VERSION,
        outcome: "conclusive",
        evidence,
      };
    }
    return {
      action: "discard",
      reason: "zero best value requires strict absolute improvement",
      improvementPct: null,
      policyVersion: POLICY_VERSION,
      outcome: "below_threshold",
      evidence,
    };
  }

  if (improvement === null) {
    // Unreachable in practice: a null improvement only occurs when the best
    // median is zero, which returns earlier. Fail closed if that ever breaks.
    return {
      action: "discard",
      reason: "no improvement metric could be computed",
      improvementPct: null,
      policyVersion: POLICY_VERSION,
      outcome: "invalid",
      evidence,
    };
  }

  if (requireSignificance && !significance.significant) {
    return {
      action: "discard",
      reason: `improvement ${improvement.toFixed(2)}% is not statistically significant (p=${significance.pValue.toFixed(4)} >= alpha=${alpha})`,
      improvementPct: improvement,
      policyVersion: POLICY_VERSION,
      outcome: "not_significant",
      evidence,
    };
  }

  if (improvement >= threshold) {
    return {
      action: "keep",
      reason: `improved ${improvement.toFixed(2)}% over current best (threshold ${threshold.toFixed(2)}%, p=${significance.pValue.toFixed(4)})`,
      improvementPct: improvement,
      policyVersion: POLICY_VERSION,
      outcome: "conclusive",
      evidence,
    };
  }

  return {
    action: "discard",
    reason: `improvement ${improvement.toFixed(2)}% is below threshold ${threshold.toFixed(2)}%`,
    improvementPct: improvement,
    policyVersion: POLICY_VERSION,
    outcome: "below_threshold",
    evidence,
  };
}

/**
 * Threshold-only decision for a single candidate/best value pair.
 * Kept for backwards compatibility; prefer decideWithSamples when the
 * benchmark produced repeated samples.
 */
export function decideValue(params: {
  candidate: number;
  best?: number | null;
  direction: Direction;
  minEffectSizePct?: number;
  noiseFloorPct?: number;
  testsPassed?: boolean;
  noisy?: boolean;
}): DecisionResult {
  const direction = params.direction;
  const minEffectSizePct = params.minEffectSizePct ?? 3.0;
  const noiseFloorPct = params.noiseFloorPct ?? 0.0;
  const candidate = params.candidate;

  if (direction !== "lower" && direction !== "higher") throw new Error("direction must be 'lower' or 'higher'");
  if (!Number.isFinite(candidate)) {
    return { action: "discard", reason: "candidate metric is not finite", improvementPct: null, policyVersion: POLICY_VERSION, outcome: "invalid" };
  }
  if (params.testsPassed === false) {
    return { action: "discard", reason: "correctness checks failed", improvementPct: null, policyVersion: POLICY_VERSION, outcome: "invalid" };
  }
  if (params.noisy) {
    return { action: "stop", reason: "benchmark noise too high", improvementPct: null, policyVersion: POLICY_VERSION, outcome: "noisy" };
  }
  if (params.best === undefined || params.best === null) {
    return { action: "baseline", reason: "first measurement becomes baseline", improvementPct: 0, policyVersion: POLICY_VERSION, outcome: "baseline" };
  }
  if (!Number.isFinite(params.best)) throw new Error("best must be a finite number when provided");

  const best = params.best;
  const threshold = Math.max(minEffectSizePct, noiseFloorPct);

  if (best === 0) {
    const improved = direction === "lower" ? candidate < 0 : candidate > 0;
    const improvementPct = improved ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    return {
      action: improved ? "keep" : "discard",
      reason: "zero best value requires strict absolute improvement",
      improvementPct,
      policyVersion: POLICY_VERSION,
      outcome: improved ? "conclusive" : "below_threshold",
    };
  }

  const improvementPct = direction === "lower"
    ? ((best - candidate) / Math.abs(best)) * 100
    : ((candidate - best) / Math.abs(best)) * 100;

  // Shared rule with decideWithSamples and benchmark-policy.md: keep at a
  // threshold tie (improvement_pct >= max(min_effect_size_pct, noise_floor_pct)).
  if (improvementPct >= threshold) {
    const text = `improved ${improvementPct.toFixed(2)}% over current best (threshold ${threshold.toFixed(2)}%)`;
    return { action: "keep", reason: text, improvementPct, policyVersion: POLICY_VERSION, outcome: "conclusive" };
  }

  const text = `improvement ${improvementPct.toFixed(2)}% is below threshold ${threshold.toFixed(2)}% or worse than best`;
  return { action: "discard", reason: text, improvementPct, policyVersion: POLICY_VERSION, outcome: "below_threshold" };
}

export function formatDecisionText(result: DecisionResult): string {
  return `${result.action.toUpperCase()} — ${result.reason}`;
}

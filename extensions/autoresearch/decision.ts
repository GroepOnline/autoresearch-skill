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
  // A zero mean with nonzero spread is the noisiest case, not a clean one:
  // report an unbounded CV so the noise gate can never pass it.
  const cvPct = count >= 2
    ? mean !== 0
      ? (stdev / Math.abs(mean)) * 100
      : stdev > 0
        ? Number.POSITIVE_INFINITY
        : 0
    : 0;
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

// The permutation statistic uses the mean difference, not the median: with
// repeated (constant) samples the median difference is insensitive to any
// minority of relabelings, so a clear 90% improvement scored p=0.5. The mean
// retains group separation under every relabeling; medians still drive the
// reported effect size.
function orientedMeanDiff(candidate: number[], best: number[], direction: Direction): number {
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const diff = mean(candidate) - mean(best);
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

/** @deprecated Statistic is now the oriented mean difference; kept as an alias for callers. */
export const permutationTestMedian = permutationTestMean;

export function permutationTestMean(
  candidate: number[],
  best: number[],
  direction: Direction,
  alpha = 0.05,
): Significance {
  if (candidate.length === 0 || best.length === 0) throw new Error("permutation test requires samples on both sides");
  if ([...candidate, ...best].some(value => !Number.isFinite(value))) throw new Error("permutation test requires finite samples");
  if (direction !== "lower" && direction !== "higher") throw new Error("direction must be 'lower' or 'higher'");

  const pooled = [...candidate, ...best];
  const candidateCount = candidate.length;
  const totalCount = pooled.length;
  const observed = orientedMeanDiff(candidate, best, direction);
  const totalCombinations = binomial(totalCount, candidateCount);

  if (totalCombinations <= EXACT_PERMUTATION_LIMIT) {
    let atLeast = 0;
    let total = 0;
    for (const indices of combinations(totalCount, candidateCount)) {
      const selected = new Set(indices);
      const group = indices.map(index => pooled[index]);
      const complement = pooled.filter((_, index) => !selected.has(index));
      if (orientedMeanDiff(group, complement, direction) >= observed) atLeast++;
      total++;
    }
    return {
      method: `exact_permutation_mean(${candidateCount}v${best.length}, n=${total})`,
      pValue: atLeast / total,
      alpha,
      significant: atLeast / total < alpha,
    };
  }

  const fingerprint = `${direction}|${candidate.map(value => value.toFixed(12)).join(",")}|${best.map(value => value.toFixed(12)).join(",")}`;
  const random = mulberry32(hashString(fingerprint));
  let atLeast = 0;
  for (let i = 0; i < MONTE_CARLO_PERMUTATIONS; i++) {
    const shuffled = [...pooled];
    shuffle(shuffled, random);
    if (orientedMeanDiff(shuffled.slice(0, candidateCount), shuffled.slice(candidateCount), direction) >= observed) {
      atLeast++;
    }
  }
  const pValue = (atLeast + 1) / (MONTE_CARLO_PERMUTATIONS + 1);
  return {
    method: `monte_carlo_permutation_mean(${candidateCount}v${best.length}, n=${MONTE_CARLO_PERMUTATIONS})`,
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

export function evaluateGuardrails(guardrails: GuardrailInput[]): { results: GuardrailResult[]; failures: string[] } {
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
  isSignificanceRequired: boolean;
}): Record<string, unknown> {
  return {
    policy_version: POLICY_VERSION,
    min_effect_size_pct: policy.minEffectSizePct,
    noise_floor_pct: policy.noiseFloorPct,
    alpha: policy.alpha,
    min_samples: policy.minSamples,
    require_significance: policy.isSignificanceRequired,
  };
}

/** Fully resolved decision policy: every default applied once, up front. */
interface ResolvedPolicy {
  minEffectSizePct: number;
  noiseFloorPct: number;
  alpha: number;
  minSamples: number;
  isSignificanceRequired: boolean;
}

function resolvePolicy(policy?: DecisionPolicy): ResolvedPolicy {
  return {
    minEffectSizePct: policy?.min_effect_size_pct ?? 3.0,
    noiseFloorPct: policy?.noise_floor_pct ?? 0.0,
    alpha: policy?.alpha ?? 0.05,
    minSamples: policy?.min_samples ?? 3,
    isSignificanceRequired: policy?.require_significance ?? true,
  };
}

function assertPolicyBounds(direction: Direction, policy: ResolvedPolicy): void {
  if (direction !== "lower" && direction !== "higher") throw new Error("direction must be 'lower' or 'higher'");
  if (!(policy.alpha > 0 && policy.alpha <= 1)) throw new Error("alpha must be in (0, 1]");
  if (policy.minSamples < 2) throw new Error("min_samples must be at least 2");
  if (!(policy.minEffectSizePct >= 0 && policy.minEffectSizePct <= 100)) throw new Error("min_effect_size_pct must be in [0, 100]");
  if (!(policy.noiseFloorPct >= 0 && policy.noiseFloorPct <= 100)) throw new Error("noise_floor_pct must be in [0, 100]");
}

function invalidDecision(reason: string): DecisionResult {
  return { action: "discard", reason, improvementPct: null, policyVersion: POLICY_VERSION, outcome: "invalid" };
}

/** Evaluate gates in order and return the first decision that fires. */
function firstDecision(...gates: (() => DecisionResult | null)[]): DecisionResult | null {
  for (const gate of gates) {
    const result = gate();
    if (result !== null) return result;
  }
  return null;
}

function rejectInvalidMeasurement(candidateSamples: number[], hasPassedTests: boolean | undefined): DecisionResult | null {
  if (candidateSamples.length === 0) return invalidDecision("candidate has no samples");
  if (candidateSamples.some(value => !Number.isFinite(value))) {
    return invalidDecision("candidate samples contain non-finite values");
  }
  if (hasPassedTests === false) return invalidDecision("correctness checks failed");
  return null;
}

function rejectOnStopPolicy(history?: DecisionHistory): DecisionResult | null {
  if (!history) return null;
  const stop = evaluateStopPolicy(history);
  if (!stop.stopped) return null;
  return {
    action: "stop",
    reason: stop.reason ?? "stop policy triggered",
    improvementPct: null,
    policyVersion: POLICY_VERSION,
    outcome: "stopped",
  };
}

function rejectNonFiniteBest(bestSamples: number[]): DecisionResult | null {
  if (bestSamples.some(value => !Number.isFinite(value))) {
    return invalidDecision("best samples contain non-finite values");
  }
  return null;
}

/**
 * Candidate-only gates: noise, sample sufficiency, and baseline detection.
 * A first measurement becomes the comparison point for every later run — it
 * must survive the same noise and sample gates as any candidate before it may
 * be persisted as best.
 */
function candidateMeasurementGate(
  candidateStats: SampleStats,
  hasBest: boolean,
  policy: ResolvedPolicy
): DecisionResult | null {
  if (policy.noiseFloorPct > 0 && candidateStats.cvPct > policy.noiseFloorPct) {
    return {
      action: "stop",
      reason: `benchmark noise exceeds floor — candidate CV ${candidateStats.cvPct.toFixed(2)}% (floor ${policy.noiseFloorPct.toFixed(2)}%)`,
      improvementPct: null,
      policyVersion: POLICY_VERSION,
      outcome: "noisy",
      evidence: { candidate: candidateStats },
    };
  }
  if (candidateStats.count < policy.minSamples) {
    return {
      action: "discard",
      reason: `insufficient samples — candidate n=${candidateStats.count} (minimum ${policy.minSamples})`,
      improvementPct: null,
      policyVersion: POLICY_VERSION,
      outcome: "insufficient_samples",
      evidence: { candidate: candidateStats },
    };
  }
  if (!hasBest) {
    return {
      action: "baseline",
      reason: "first valid measurement becomes baseline",
      improvementPct: 0.0,
      policyVersion: POLICY_VERSION,
      outcome: "baseline",
      evidence: { candidate: candidateStats },
    };
  }
  return null;
}

/** Gates that need both sides: noise floor on either side, then sufficiency. */
function pairMeasurementGate(
  candidateStats: SampleStats,
  bestStats: SampleStats,
  policy: ResolvedPolicy,
  evidence: Record<string, unknown>
): DecisionResult | null {
  if (policy.noiseFloorPct > 0 && (candidateStats.cvPct > policy.noiseFloorPct || bestStats.cvPct > policy.noiseFloorPct)) {
    return {
      action: "stop",
      reason: `benchmark noise exceeds floor — candidate CV ${candidateStats.cvPct.toFixed(2)}% / best CV ${bestStats.cvPct.toFixed(2)}% (floor ${policy.noiseFloorPct.toFixed(2)}%)`,
      improvementPct: null,
      policyVersion: POLICY_VERSION,
      outcome: "noisy",
      evidence,
    };
  }
  if (candidateStats.count < policy.minSamples || bestStats.count < policy.minSamples) {
    return {
      action: "discard",
      reason: `insufficient samples — candidate n=${candidateStats.count}, best n=${bestStats.count} (minimum ${policy.minSamples} per side)`,
      improvementPct: null,
      policyVersion: POLICY_VERSION,
      outcome: "insufficient_samples",
      evidence,
    };
  }
  return null;
}

/** Attach guardrail evidence, then reject the candidate on any regression. */
function applyGuardrails(
  guardrails: GuardrailInput[],
  evidence: Record<string, unknown>
): DecisionResult | null {
  const { results: guardrailResults, failures: guardrailFailures } = evaluateGuardrails(guardrails);
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
  return null;
}

/**
 * A simplification may only keep a statistically tied candidate. A
 * significantly worse candidate must not survive via the simplification
 * branch, so the reverse direction is tested before keeping.
 */
function simplificationDecision(args: {
  direction: Direction;
  policy: ResolvedPolicy;
  candidateSamples: number[];
  bestSamples: number[];
  significance: Significance;
  improvement: number | null;
  simplification?: { removes_complexity?: boolean; behavior_unchanged?: boolean };
  evidence: Record<string, unknown>;
}): DecisionResult | null {
  const { direction, policy, candidateSamples, bestSamples, significance, improvement, simplification, evidence } =
    args;
  const tied = !significance.significant
    && simplification?.removes_complexity === true
    && simplification.behavior_unchanged === true;
  if (!tied) return null;

  const reverseDirection: Direction = direction === "lower" ? "higher" : "lower";
  const worse = permutationTestMean(candidateSamples, bestSamples, reverseDirection, policy.alpha).significant;
  if (worse) {
    return {
      action: "discard",
      reason: `simplification candidate is significantly worse (reverse p < ${policy.alpha})`,
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

/** A zero best median leaves no relative improvement metric: require an absolute win. */
function zeroMedianDecision(args: {
  direction: Direction;
  candidateStats: SampleStats;
  bestStats: SampleStats;
  significance: Significance;
  evidence: Record<string, unknown>;
}): DecisionResult | null {
  const { direction, candidateStats, bestStats, significance, evidence } = args;
  if (bestStats.median !== 0) return null;

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

/** Significance gate first, then the minimum effect size. Always decides. */
function thresholdDecision(args: {
  policy: ResolvedPolicy;
  improvement: number | null;
  threshold: number;
  significance: Significance;
  evidence: Record<string, unknown>;
}): DecisionResult {
  const { policy, threshold, significance, evidence } = args;
  const improvement = args.improvement;

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
  if (policy.isSignificanceRequired && !significance.significant) {
    return {
      action: "discard",
      reason: `improvement ${improvement.toFixed(2)}% is not statistically significant (p=${significance.pValue.toFixed(4)} >= alpha=${policy.alpha})`,
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

/** Significance test + effect size, then the ordered outcome ladder. */
function decideFromSamples(args: {
  direction: Direction;
  policy: ResolvedPolicy;
  candidateSamples: number[];
  bestSamples: number[];
  candidateStats: SampleStats;
  bestStats: SampleStats;
  threshold: number;
  evidence: Record<string, unknown>;
  simplification?: { removes_complexity?: boolean; behavior_unchanged?: boolean };
}): DecisionResult {
  const { direction, policy, candidateSamples, bestSamples, candidateStats, bestStats, threshold, evidence } = args;

  const significance = permutationTestMean(candidateSamples, bestSamples, direction, policy.alpha);
  evidence.significance = {
    method: significance.method,
    p_value: significance.pValue,
    alpha: significance.alpha,
    significant: significance.significant,
  };

  const improvement = relativeImprovement(direction, candidateStats.median, bestStats.median);
  if (improvement !== null) evidence.effect_size_pct = improvement;

  const simplification = args.simplification;
  if (simplification !== undefined) {
    evidence.simplification = {
      removes_complexity: simplification.removes_complexity === true,
      behavior_unchanged: simplification.behavior_unchanged === true,
    };
  }

  const simplificationOutcome = simplificationDecision({
    direction,
    policy,
    candidateSamples,
    bestSamples,
    significance,
    improvement,
    simplification,
    evidence,
  });
  if (simplificationOutcome) return simplificationOutcome;

  const zeroOutcome = zeroMedianDecision({ direction, candidateStats, bestStats, significance, evidence });
  if (zeroOutcome) return zeroOutcome;

  return thresholdDecision({ policy, improvement, threshold, significance, evidence });
}

export function decideWithSamples(params: {
  candidateSamples: number[];
  bestSamples?: number[] | null;
  direction: Direction;
  policy?: DecisionPolicy;
  hasPassedTests?: boolean;
  guardrails?: GuardrailInput[];
  history?: DecisionHistory;
  simplification?: { removes_complexity?: boolean; behavior_unchanged?: boolean };
}): DecisionResult {
  const direction = params.direction;
  const policy = resolvePolicy(params.policy);
  const candidateSamples = [...params.candidateSamples];
  const bestSamples = params.bestSamples ? [...params.bestSamples] : [];

  assertPolicyBounds(direction, policy);

  const inputRejection = firstDecision(
    () => rejectInvalidMeasurement(candidateSamples, params.hasPassedTests),
    () => rejectOnStopPolicy(params.history),
    () => rejectNonFiniteBest(bestSamples)
  );
  if (inputRejection) return inputRejection;

  const candidateStats = computeStats(candidateSamples);
  const candidateRejection = candidateMeasurementGate(candidateStats, bestSamples.length > 0, policy);
  if (candidateRejection) return candidateRejection;

  const bestStats = computeStats(bestSamples);
  const threshold = Math.max(policy.minEffectSizePct, policy.noiseFloorPct);
  const evidence: Record<string, unknown> = {
    candidate: candidateStats,
    best: bestStats,
    threshold_pct: threshold,
    policy: evidencePolicy(policy),
  };

  const pairRejection = pairMeasurementGate(candidateStats, bestStats, policy, evidence);
  if (pairRejection) return pairRejection;

  const guardrailRejection = applyGuardrails(params.guardrails ?? [], evidence);
  if (guardrailRejection) return guardrailRejection;

  return decideFromSamples({
    direction,
    policy,
    candidateSamples,
    bestSamples,
    candidateStats,
    bestStats,
    threshold,
    evidence,
    simplification: params.simplification,
  });
}

function assertScalarPolicy(direction: Direction, minEffectSizePct: number, noiseFloorPct: number): void {
  if (direction !== "lower" && direction !== "higher") throw new Error("direction must be 'lower' or 'higher'");
  if (!(minEffectSizePct >= 0 && minEffectSizePct <= 100)) throw new Error("min_effect_size_pct must be in [0, 100]");
  if (!(noiseFloorPct >= 0 && noiseFloorPct <= 100)) throw new Error("noise_floor_pct must be in [0, 100]");
}

function rejectScalarInput(
  params: { best?: number | null; hasPassedTests?: boolean; isNoisy?: boolean },
  candidate: number
): DecisionResult | null {
  if (!Number.isFinite(candidate)) return invalidDecision("candidate metric is not finite");
  if (params.hasPassedTests === false) return invalidDecision("correctness checks failed");
  if (params.isNoisy) {
    return {
      action: "stop",
      reason: "benchmark noise too high",
      improvementPct: null,
      policyVersion: POLICY_VERSION,
      outcome: "noisy",
    };
  }
  if (params.best === undefined || params.best === null) {
    return {
      action: "baseline",
      reason: "first measurement becomes baseline",
      improvementPct: 0,
      policyVersion: POLICY_VERSION,
      outcome: "baseline",
    };
  }
  return null;
}

function zeroBestScalarDecision(direction: Direction, candidate: number): DecisionResult {
  const improved = direction === "lower" ? candidate < 0 : candidate > 0;
  return {
    action: improved ? "keep" : "discard",
    reason: "zero best value requires strict absolute improvement",
    // No relative improvement exists against a zero best value; every other
    // zero-best path (and the Python `decide` helper) reports null. Returning
    // ±Infinity only survived JSON serialisation because JSON.stringify maps
    // it to null, so in-memory consumers saw a different value than the wire.
    improvementPct: null,
    policyVersion: POLICY_VERSION,
    outcome: improved ? "conclusive" : "below_threshold",
  };
}

function scalarImprovementPct(direction: Direction, candidate: number, best: number): number {
  return direction === "lower"
    ? ((best - candidate) / Math.abs(best)) * 100
    : ((candidate - best) / Math.abs(best)) * 100;
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
  hasPassedTests?: boolean;
  isNoisy?: boolean;
}): DecisionResult {
  const direction = params.direction;
  const minEffectSizePct = params.minEffectSizePct ?? 3.0;
  const noiseFloorPct = params.noiseFloorPct ?? 0.0;
  const candidate = params.candidate;

  assertScalarPolicy(direction, minEffectSizePct, noiseFloorPct);

  const rejected = rejectScalarInput(params, candidate);
  if (rejected) return rejected;
  if (typeof params.best !== "number" || !Number.isFinite(params.best))
    throw new Error("best must be a finite number when provided");

  const best = params.best;
  const threshold = Math.max(minEffectSizePct, noiseFloorPct);

  if (best === 0) return zeroBestScalarDecision(direction, candidate);

  const improvementPct = scalarImprovementPct(direction, candidate, best);

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

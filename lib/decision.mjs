/**
 * @module decision
 * Keep/discard decision engine for autoresearch improvement attempts.
 *
 * Two decision paths:
 * 1. decideMetric() — baseline-relative decision (used for global benchmark runs)
 * 2. decideImprovement() — before/after comparison (used for per-skill improvement runs)
 *
 * Both respect configurable noise floor and minimum effect size thresholds.
 */

/**
 * @typedef {Object} Decision
 * @property {"keep"|"discard"|"baseline"|"stop"} action
 * @property {string} reason - Human-readable reason for the decision
 */

/**
 * @typedef {Object} DecisionConfig
 * @property {"higher"|"lower"} direction - Whether higher or lower is better
 * @property {number} [noise_floor_pct=5] - Minimum delta % to be above noise
 * @property {number} [min_effect_size_pct=2] - Minimum delta % to be meaningful
 */

/**
 * Baseline-relative decision engine.
 * Compares a measurement result against the baseline metric.
 *
 * @param {Object} result - Measurement result
 * @property {number} result.value - The measured value
 * @param {DecisionConfig} config
 * @param {number|null} baselineMetric - The baseline value (null if first measurement)
 * @returns {Decision}
 */
export function decideMetric(result, config, baselineMetric) {
  if (!config) return { action: "stop", reason: "no config" };
  if (baselineMetric === null) {
    return { action: "baseline", reason: "first measurement" };
  }

  const delta = result.value - baselineMetric;
  const deltaPct = (delta / Math.abs(baselineMetric)) * 100;
  const isImprovement = config.direction === "higher" ? delta > 0 : delta < 0;
  const aboveNoise = Math.abs(deltaPct) >= (config.noise_floor_pct || 5);
  const aboveEffect = Math.abs(deltaPct) >= (config.min_effect_size_pct || 2);

  if (isImprovement && aboveNoise && aboveEffect) {
    return { action: "keep", reason: `improved by ${deltaPct.toFixed(1)}%` };
  }
  if (isImprovement && !aboveNoise) {
    return {
      action: "discard",
      reason: `improvement ${deltaPct.toFixed(1)}% below noise floor`,
    };
  }
  return { action: "discard", reason: `no improvement (${deltaPct.toFixed(1)}%)` };
}

/**
 * Before/after comparison decision engine.
 * Compares a per-skill improvement attempt against the pre-improvement score.
 *
 * @param {number} beforeScore - Score before improvement attempt
 * @param {number} afterScore - Score after improvement attempt
 * @param {Object} config
 * @property {number} [config.noise_floor_pct=5] - Minimum delta % to be above noise
 * @returns {Decision}
 */
export function decideImprovement(beforeScore, afterScore, config) {
  const delta = afterScore - beforeScore;
  const deltaPct =
    beforeScore > 0 ? (delta / beforeScore) * 100 : afterScore > 0 ? 100 : 0;
  const aboveNoise = Math.abs(deltaPct) >= (config?.noise_floor_pct || 5);
  const isImprovement = delta > 0;

  if (isImprovement && aboveNoise) {
    return {
      action: "keep",
      reason: `improved by ${deltaPct.toFixed(1)}% (${beforeScore} \u2192 ${afterScore})`,
    };
  }
  if (isImprovement) {
    return {
      action: "discard",
      reason: `improvement ${deltaPct.toFixed(1)}% below noise floor`,
    };
  }
  return { action: "discard", reason: `no improvement (${deltaPct.toFixed(1)}%)` };
}

# Benchmark Policy

Single-run timing is not enough for keep/discard decisions. Use repeated samples and compare medians.

## Default run policy

- Warmup runs: 2
- Measured samples: 7
- Primary statistic: median
- Noise check: fail or stop when variability is above the configured threshold
- Minimum effect size: 3 percent unless configured otherwise

## Metric output

Benchmarks must print at least one primary metric line:

```text
METRIC latency_ms=12.4 direction=lower
```

Supported numeric values include integers, decimals, negative values, and scientific notation.

## Keep/discard policy

Compute relative improvement against `abs(median_best)` so negative metric values behave correctly.

For `direction=lower`:

- `improvement_pct = (median_best - median_new) / abs(median_best) * 100`
- keep if `improvement_pct >= max(min_effect_size_pct, noise_floor_pct)`
- discard if below the threshold, noisy, failing, or worse than best

For `direction=higher`:

- `improvement_pct = (median_new - median_best) / abs(median_best) * 100`
- keep if `improvement_pct >= max(min_effect_size_pct, noise_floor_pct)`
- discard if below the threshold, noisy, failing, or worse than best

The comparison is inclusive on every decision path: `decideValue` and `decideMetric` (`extensions/autoresearch/decision.ts`, `extensions/autoresearch/tools.ts`), `decideWithSamples`, and the Python `decide` / `decide_with_samples` helpers all use `>=`, so a result exactly at the threshold is a keep. The scalar boundary is pinned by `tests-ts/decision.test.ts` ("decideValue keeps at the threshold boundary like decideWithSamples") and by `DecisionTests.test_scalar_decide_keeps_at_the_threshold_boundary` on the Python side.

A result that beats the original baseline but is worse than the current best is a discard by default.

## Statistical ties and simplification

This is a separate axis from the threshold tie above. When the permutation test is not significant (`p >= alpha`), the candidate is discarded unless `simplification` evidence is supplied:

- `removes_complexity: true`
- `behavior_unchanged: true`

`_simplification_decision` (Python) and `simplificationDecision` (TypeScript) then run the reverse-direction permutation test, so a statistically tied simplification is kept (`outcome: "simplification"`) while a significantly worse one is discarded. Tests must pass on both paths, and the reason is recorded in the decision event.

## Noisy results

If measured samples vary too much:

1. Increase sample count.
2. Check CPU, I/O, network, and GC causes.
3. Add a real-backend smoke benchmark when mocks hide production latency.
4. Stop instead of making a keep/discard decision when noise remains above threshold.

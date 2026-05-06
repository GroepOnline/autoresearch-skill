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

For `direction=lower`:

- keep if `median_new < median_best * (1 - min_effect_size_pct / 100)`
- discard if equal, noisy, failing, or worse than best

For `direction=higher`:

- keep if `median_new > median_best * (1 + min_effect_size_pct / 100)`
- discard if equal, noisy, failing, or worse than best

A result that beats the original baseline but is worse than the current best is a discard by default.

## Ties and simplification

A statistically tied result may be kept only when all of these are true:

- tests pass
- behavior is unchanged
- the diff removes complexity or risk
- the reason is recorded in the decision event

## Noisy results

If measured samples vary too much:

1. Increase sample count.
2. Check CPU, I/O, network, and GC causes.
3. Add a real-backend smoke benchmark when mocks hide production latency.
4. Stop instead of making a keep/discard decision when noise remains above threshold.

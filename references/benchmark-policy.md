# Benchmark Policy

Single-run timing is not enough for keep/discard decisions. Use repeated samples and compare medians. The v3 decision model (`scripts/autoresearch.py` and `extensions/autoresearch/decision.ts`) implements the policy below.

## Default run policy

- Warmup runs: 2
- Measured samples: 7
- Primary statistic: median
- Significance: one-sided permutation test at `alpha` (default 0.05)
- Noise check: fail or stop when variability is above the configured threshold
- Minimum effect size: 3 percent unless configured otherwise
- Guardrails: secondary metrics must not regress beyond their tolerance

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

## Statistical decision model (v3)

When repeated samples are supplied, the engine scores the full sample distribution instead of a single number:

1. Invalid input or failing correctness checks → `discard` (`outcome: invalid`).
2. Stop policy (budget, consecutive discards, plateau) → `stop` (`outcome: stopped`).
3. No best samples yet → `baseline`.
4. Noise gate: candidate or best CV above `noise_floor_pct` → `stop` (`outcome: noisy`).
5. Sample sufficiency: fewer than `min_samples` per side → `discard` (`outcome: insufficient_samples`).
6. Guardrails: any secondary metric regressed beyond `tolerance_pct` → `discard` (`outcome: guardrail_failed`).
7. Significance: one-sided permutation test on the oriented median difference.
8. Keep only when the difference is significant (`p < alpha`) and the relative improvement is at least `max(min_effect_size_pct, noise_floor_pct)`.

Discard and stop decisions carry the evidence: sample statistics, CV, threshold, policy, p-value, and guardrail results.

### Permutation test

The pooled candidate and best samples are relabeled; the p-value is the fraction of relabelings whose oriented median difference is at least the observed one. Up to 20,000 relabelings are enumerated exactly; larger samples fall back to a deterministic Monte Carlo run (10,000 permutations, seeded from the sample values).

### Decision policy

```json
{
  "min_effect_size_pct": 3.0,
  "noise_floor_pct": 5.0,
  "alpha": 0.05,
  "min_samples": 3,
  "require_significance": true
}
```

- `min_samples` must be at least 2; fewer samples per side are rejected as `insufficient_samples`.
- Set `require_significance: false` to keep the older threshold-only behavior while still recording the test.
- Guardrail shape: `{"name":"memory_mb","direction":"lower","tolerance_pct":2,"candidate":110,"best":100}`.
- Stop-policy history shape: `{"consecutive_discards":0,"runs_since_improvement":0,"max_consecutive_discards":5,"max_runs_without_improvement":10,"remaining_runs":5,"remaining_minutes":30}`.

### CLI examples

```bash
python3 scripts/autoresearch.py decide --direction lower \
  --samples 100 101 99 102 98 100 101 \
  --best-samples 120 121 119 122 118 120 121

python3 scripts/autoresearch.py stop-check autoresearch.jsonl --remaining-runs 0
```

## Ties and simplification

A statistically tied result may be kept only when all of these are true:

- tests pass
- behavior is unchanged
- the diff removes complexity or risk
- the reason is recorded in the decision event

Pass `simplification: {"removes_complexity": true, "behavior_unchanged": true}` to the `autoresearch_decide` tool to record such a keep; the decision action is `keep` with `outcome: simplification`.

## Noisy results

If measured samples vary too much:

1. Increase sample count.
2. Check CPU, I/O, network, and GC causes.
3. Add a real-backend smoke benchmark when mocks hide production latency.
4. Stop instead of making a keep/discard decision when noise remains above threshold.

## Stop policy

The same engine owns the loop stop conditions; `stop-check` derives them from `autoresearch.jsonl`:

- `remaining_runs <= 0` → run budget exhausted
- `remaining_minutes <= 0` → time budget exhausted
- trailing discards ≥ `max_consecutive_discards` (default 5)
- runs since the last `keep`/`baseline` ≥ `max_runs_without_improvement` (default 10)

A stop decision is written to JSONL like any other decision; the loop then ends instead of burning more budget.

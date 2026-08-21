---
name: pi-autoresearch
description: Run self-improving optimization loops that benchmark strategies against baseline, track metrics forever, and auto-select best approaches. Use when you need to find optimal solutions through iterative experimentation without human intervention.
---

## When to Use

- Optimizing algorithms, compression, or any measurable process
- Finding best strategy among multiple candidates automatically
- Running "forever loops" that improve until stopped
- Benchmarking deterministic approaches without LLM calls

## Core Pattern

```
┌─────────────────────────────────────────┐
│  BASELINE: Record initial metric value   │
└────────────────┬────────────────────────┘
                   │
       ┌───────────▼───────────┐
       │   RUN EXPERIMENT #N    │
       │  (deterministic, fast) │
       └───────────┬───────────┘
                   │
       ┌───────────▼───────────┐
       │   METRIC IMPROVED?    │
       │  (vs baseline/best)   │
       └─────┬─────────┬───────┘
             │ YES     │ NO
             │         │
   ┌─────────▼──┐  ┌───▼────────┐
   │  KEEP IT   │  │  DISCARD   │
   │ new best!  │  │  try next  │
   └────────────┘  └────────────┘
             │         │
             └────┬────┘
                  │
            LOOP FOREVER
```

## Setup Requirements

### 1. Benchmark Harness (`tests/autoresearch-*.test.ts`)

Must emit `METRIC name=value` line(s) and complete in ≤100ms:

```typescript
test("measures fallback latency", async () => {
  const start = Date.now();
  await runAgent(request);
  const latency = Date.now() - start;
  expect(latency).toBeLessThan(5);
  console.log(`METRIC fallback_latency_ms=${latency}`);
});
```

See skill `autoresearch-benchmark-harness` for full template.

### 2. Shell Wrapper (`autoresearch.sh`)

```bash
#!/usr/bin/env bash
set -euo pipefail

OUT=$(npm test --silent -- tests/autoresearch-fallback-latency.test.ts 2>&1)
METRIC=$(printf '%s\n' "$OUT" | grep -Eo 'METRIC [^=]+=[0-9.]+' | head -1)
echo "$METRIC"
```

### 3. State File (`AUTORESEARCH_STATE.json`)

```json
{
  "experiment": "fallback-latency-20260506",
  "baseline": { "fallback_latency_ms": 507 },
  "runs": [],
  "best": { "run": 1, "fallback_latency_ms": 507 }
}
```

## Procedure

1. **Establish baseline**: Run current code, record initial metric
2. **Create experiment branch**: `git checkout -b opt/remove-backoff`
3. **Make ONE focused change** (≤20 lines diff)
4. **Run harness**: `./autoresearch.sh`
5. **Compare metric**:
   - `< best_so_far` → `KEEP` (new best)
   - `> baseline` → `DISCARD`
   - `> baseline && < best` → `KEEP` (incremental progress)
6. **Record decision**: Append to `AUTORESEARCH_LOG.md`
7. **If KEEP**: keep commit; if `DISCARD`: `git reset --hard HEAD~`
8. **Repeat** until 5 consecutive discards or 10 runs without improvement

## Decision Matrix

| Condition                            | Action                             | Rationale                     |
| ------------------------------------ | ---------------------------------- | ----------------------------- |
| `metric < best`                      | ✅ KEEP — new best                 | Always keep improvements      |
| `metric == best`                     | ❌ DISCARD (unless simplification) | No gain, extra complexity     |
| `metric > baseline && metric < best` | ✅ KEEP                            | Incremental progress          |
| `metric > best`                      | ❌ DISCARD                         | Pure regression               |
| Any test failure                     | ❌ DISCARD immediately             | Functional correctness > perf |

## Logging Format

`AUTORESEARCH_LOG.md`:

```markdown
## Run #2 — 2026-05-06T14:00:00+02:00

- Metric: `METRIC fallback_latency_ms=2`
- Action: **KEEP** — new best (-99.6% vs baseline)
- Change: "Remove backoff while walking explicit fallbackModels chain"
- Diff: `git show HEAD~2 --stat` (2 files, 4 insertions, 2 deletions)
- Hypothesis: Eliminating sleep() between fallback attempts reduces latency
- Verification: All fallback/cache tests still pass
```

## Variable Isolation Rule

**One optimization per run.** Never bundle multiple independent changes:

- ❌ Bad: "Remove backoff + bypass cache key gen + reuse backend"
- ✅ Good: Three separate branches, three separate runs

If you suspect two changes interact, verify independently first, then test combined in a separate run.

## Stopping Conditions

- **5 consecutive DISCARD** with no improvement → local maximum
- **Best metric stable for 10+ runs** → diminishing returns
- **New direction needed** → start fresh experiment (new `AUTORESEARCH_STATE_*.json`)
- **Timebox**: Max 30 runs per experiment cycle

## Pitfalls (Lessons from agent-runtime 2026-05-06)

### Noise-Driven Decisions

- **Symptom**: Metric jumps 1ms → 5ms → 1ms across runs
- **Fix**: Use **median of 5 runs** in benchmark harness
- **Rule**: Variability > ±20% → increase run count or investigate GC/CPU noise

### Confounding Variables

- **Symptom**: Change A "improves" but change B also present
- **Fix**: Strict **one variable per run**. Max 20 lines diff per commit.
- **Rule**: `git diff baseline` must show ≤ 20 lines changed.

### Metric vs Reality Gap

- **Symptom**: Benchmark 1ms, production 100ms
- **Causes**: Mocks bypass real I/O; metric measures wrong thing
- **Fix**: Add **sanity-check smoke test** with real backend (slow but indicative). Track both: mock-based (iteration speed) + real-backend (ground truth).

### Backend Reuse Instability

- **Symptom**: Reusing backend instance across retries reduces object allocation
- **Reality**: SDK state leakage, session invalidation bugs
- **Rule**: Keep **one fresh session per run** unless benchmark proves stability over 20+ iterations.

### Cache Bypass Blind Spot

- **Symptom**: `useCache=false` still pays cache key generation cost
- **Fix**: Early return before `makeCacheKey()` is called
- **Metric impact**: 507ms → 1ms (cache bypass + backoff removal were both required)

## Output Artifacts

After loop termination:

- `AUTORESEARCH_STATE.json` — final best metric and run history
- `AUTORESEARCH_LOG.md` — human-readable decision trail
- `METRIC_BASELINE` — original baseline number (immutable reference)
- `README` updates — document the guaranteed optimization (e.g., "Sub-5ms failover")

## Related Skills

- `autoresearch-benchmark-harness` — harness structure and METRIC output format
- `autoresearch-fallback-latency` — full case study applying this loop
- `regression-test-on-optimization` — add constraint tests immediately after each KEEP
- `fallback-chain-immediate-hop` — core principle (no backoff during chain walk)
- `cache-bypass-optimization` — eliminating cache overhead when disabled

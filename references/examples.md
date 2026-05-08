# Examples

## `autoresearch.md`

```markdown
# Autoresearch: optimize parser latency

## Objective
Reduce median parser latency for the standard fixture set without changing output.

## Metrics
- Primary: latency_ms, lower is better
- Secondary: allocations, lower is better

## Budget
- Max runs: 30
- Max minutes: 60
- Stop after: 5 consecutive discards

## Files in Scope
- src/parser.ts
- src/tokenizer.ts
- tests/parser-benchmark.test.ts

## Off Limits
- package.json
- package-lock.json
- production config
- credentials

## How to Run
`./autoresearch.sh` prints `METRIC latency_ms=<number> direction=lower`.

## What's Been Tried
- Baseline only.
```

## `autoresearch.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

npm test --silent -- tests/parser-benchmark.test.ts
```

The benchmark test should print the `METRIC` line after computing warmups and measured samples.

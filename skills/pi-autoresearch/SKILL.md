---
name: pi-autoresearch
description: run bounded, benchmark-driven optimization loops for pi coding agent and repository experiments. use when the user asks to start, resume, audit, or design autoresearch workflows that test one hypothesis at a time, compare measured metrics against a baseline, keep only statistically meaningful improvements, preserve crash-safe state, and avoid unsafe git operations.
---

# Autoresearch

Canonical Pi entrypoint for this package.

Use this skill to run controlled optimization research in a repository. The core pattern is: establish a baseline, test one hypothesis, measure with a repeatable benchmark, keep only meaningful improvements, record every decision, and stop when the configured budget or safety limits are reached.

## Start workflow

1. Verify that the repository has a clean git state. Stop if there are any uncommitted changes.
2. Create or load `autoresearch.md`, `autoresearch.jsonl`, and `experiments/worklog.md`.
3. Confirm the optimization target, primary metric, direction (`lower` or `higher`), files in scope, off-limits paths, and run budget.
4. Establish a baseline with the same benchmark policy used for future runs.
5. Run one hypothesis per experiment. Keep diffs focused and inside the declared scope.
6. Parse `METRIC name=value` lines, compute the benchmark summary, and record the result in append-only JSONL.
7. Decide keep or discard using the benchmark policy. Never keep a result that is worse than the current best just because it beats the original baseline.
8. Generate or update the dashboard and worklog.
9. Stop when a budget, safety rule, noisy benchmark, repeated discard limit, or local optimum condition is reached.

## Required references

Load these files when the step requires detail:

- `references/state-protocol.md` for JSONL schema, validation, snapshots, and dashboard source-of-truth rules.
- `references/benchmark-policy.md` for sample counts, warmups, medians, noise handling, and decision thresholds.
- `references/safety-policy.md` for git isolation, destructive operation rules, scope limits, and stop conditions.
- `references/pi-extension.md` for Pi TUI commands and extension behavior.
- `references/examples.md` for scaffold examples and recommended output formats.

## Default runtime artifacts

Autoresearch sessions create runtime files in the target repository, not in this skill repository:

- `autoresearch.md` - human-readable experiment contract.
- `autoresearch.jsonl` - append-only source of truth.
- `AUTORESEARCH_STATE.json` - generated snapshot for quick resume.
- `autoresearch-dashboard.md` - generated progress dashboard.
- `experiments/worklog.md` - narrative record of hypotheses and lessons.
- `.autoresearch-off` - pause sentinel.

## Decision rule summary

- Correctness beats performance. Any functional test failure is a discard unless the experiment was explicitly a failing diagnostic run.
- Compare against the current best, not only against the original baseline.
- Use median measured samples as the primary value.
- Require a minimum effect size above the configured noise floor.
- Prefer simplification when metrics are statistically tied and behavior is unchanged.
- Stop instead of continuing when state is corrupt, git state is unsafe, the benchmark is too noisy, or the run budget is exhausted.

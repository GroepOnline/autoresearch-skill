---
name: pi-autoresearch
description: run bounded, benchmark-driven optimization loops for pi coding agent and repository experiments. use when the user asks to start, resume, audit, or design autoresearch workflows that test one hypothesis at a time, compare measured metrics against a baseline, keep only meaningful improvements above the configured effect-size and noise thresholds, preserve crash-safe state, and avoid unsafe git operations. includes ralph wiggum naive-explorer mode for fully autonomous simple-hypothesis testing.
---

# Autoresearch

Use this skill to run controlled optimization research in a repository. The core pattern is: establish a baseline, test one hypothesis, measure with a repeatable benchmark, keep only meaningful improvements, record every decision, and stop when the configured budget or safety limits are reached.

## Pi Extension

When installed as a Pi package, the plugin provides:

- **Commands**: `/autoresearch status|new|start|ralph|pause|resume|dashboard|validate`
- **Tools**: `autoresearch_state`, `autoresearch_metric`, `autoresearch_decide`, `autoresearch_dashboard`
- **Hooks**: context injection on `before_agent_start`, safety guards on `tool_call`, autonomous continuation on `agent_end`, state persistence on `session_before_compact`

### Modes

- **Assisted** (`start`) — Loop with user oversight. Each run injects context; user approves continuation.
- **Ralph Wiggum** (`ralph`) — Fully autonomous naive-explorer. Simplest hypotheses first, max ~10 line diffs, no new dependencies. Runs until budget or safety stop.

### Stop Conditions

The loop auto-stops on: budget exhausted, 5 consecutive discards, plateau (10 runs without improvement), diff-size violation, pause sentinel, corrupt state, dirty git, test failures, or benchmark noise.

## Start workflow

1. Verify that the repository has a clean git state. Stop if there is uncommitted user work outside the autoresearch workspace.
2. Create or load `autoresearch.md`, `autoresearch.jsonl`, and `experiments/worklog.md`.
3. Confirm the optimization target, primary metric, direction (`lower` or `higher`), files in scope, off-limits paths, and run budget.
4. Establish a baseline with the same benchmark policy used for future runs.
5. Run one hypothesis per experiment. Keep diffs focused and inside the declared scope.
6. Parse `METRIC name=value` lines, compute the benchmark summary, and record the result in append-only JSONL.
7. Use `autoresearch_decide` (or the Python `decide` helper) for keep/discard decisions. Never keep a result worse than the current best.
8. The plugin auto-generates context injection tables and stop summaries — no manual worklog maintenance required.
9. Stop when a budget, safety rule, noisy benchmark, consecutive discard limit, plateau, or explicit stop decision is reached.

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
- `experiments/summary-{ts}.md` - auto-generated stop summary.
- `.autoresearch-off` - pause sentinel.

## Decision rule summary

- Correctness beats performance. Any functional test failure is a discard unless the experiment was explicitly a failing diagnostic run.
- Compare against the current best, not only against the original baseline.
- Use median measured samples as the primary value.
- Require a minimum effect size above the configured noise floor.
- Prefer simplification when metrics are within the configured threshold and behavior is unchanged.
- Stop instead of continuing when state is corrupt, git state is unsafe, the benchmark is too noisy, or the run budget is exhausted.
- Stop on consecutive discards (5) or plateau (10 runs without improvement) to avoid wasting budget.

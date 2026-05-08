# Autoresearch Skill

Bounded, benchmark-driven optimization loops for Pi Coding Agent and repository experiments.

Autoresearch helps an agent test one hypothesis at a time, compare measured results against a baseline and current best, keep only meaningful improvements, and preserve crash-safe state across long sessions.

## What this repository contains

- `SKILL.md` - single canonical ChatGPT/Pi skill entrypoint.
- `extensions/autoresearch/index.ts` - canonical Pi TUI plugin for `/autoresearch` commands.
- `extension.ts` - compatibility shim for older symlink installs.
- `agents/openai.yaml` - ChatGPT skill UI metadata.
- `references/` - detailed protocols for state, benchmark decisions, safety, Pi extension behavior, and examples.
- `scripts/` - deterministic helpers for metric parsing, JSONL validation, decisions, and dashboard generation.
- `tests/` - script-level regression tests.

## Core guarantees

- Append-only JSONL state is the source of truth.
- Benchmarks use median samples and noise checks instead of single-run timing.
- Keep/discard decisions compare against the current best result.
- Git operations are bounded and avoid destructive `reset --hard HEAD~` patterns.
- Loops stop at explicit budgets, unsafe git state, corrupt state, noisy metrics, or repeated failed hypotheses.

## Runtime files created in target projects

```text
autoresearch.md
autoresearch.jsonl
AUTORESEARCH_STATE.json
autoresearch-dashboard.md
experiments/worklog.md
.autoresearch-off
```

These runtime files are ignored in this repository by default.

## Pi usage

Install as a Pi package:

```bash
pi install git:https://github.com/GroepChef/autoresearch-skill
```

For local development:

```bash
pi install /path/to/autoresearch-skill
# or for one-off testing
pi -e /path/to/autoresearch-skill/extensions/autoresearch/index.ts
```

Compatibility skill-only setup remains possible:

```yaml
skills:
  - path: GroepChef/autoresearch-skill
```

Compatibility symlink for older extension installs:

```bash
ln -s /path/to/autoresearch-skill/extension.ts ~/.pi/agent/extensions/autoresearch.ts
```

Commands:

```text
/autoresearch status
/autoresearch new <goal>   # auto-switches to an isolated autoresearch/* branch when possible
/autoresearch start [max_runs] [max_minutes]
/autoresearch ralph [max_runs] [max_minutes]
/autoresearch pause
/autoresearch resume
/autoresearch dashboard
/autoresearch validate
```

### Modes

- **Assisted** (`/autoresearch start`) — Full autonomous loop with user oversight. Each run gets context injection + budget; user approves continuation.
- **Ralph Wiggum** (`/autoresearch ralph`) — Fully autonomous naive-explorer mode. Simplest hypotheses first, max ~10 line diffs, runs until budget or safety stop. Named after the blissfully simple character.

### Custom Tools

| Tool | Purpose |
|------|---------|
| `autoresearch_state` | Read and validate JSONL state (config, runs, best, baseline) |
| `autoresearch_metric` | Parse METRIC lines from benchmark output, compute median + noise CV |
| `autoresearch_decide` | Policy-driven keep/discard/stop decision against current best |
| `autoresearch_dashboard` | Generate markdown dashboard from JSONL |

### Stop Conditions

The loop automatically stops on:

- Budget exhausted (runs or minutes)
- Explicit `stop` decision from `autoresearch_decide`
- 5 consecutive discards (no progress being made)
- Plateau — 10 runs without improvement
- Diff-size violation (50 lines assisted, 10 lines Ralph mode), including post-run git diff audit so bash mutations cannot bypass scope checks
- Pause sentinel (`.autoresearch-off`)
- Corrupt JSONL state
- Dirty git working tree at loop start, except autoresearch runtime files created by `/autoresearch new`
- Not in an isolated git context (`autoresearch/*` branch or a git worktree)
- Correctness test failures
- Benchmark noise exceeding configured threshold

### Key Features

- **Experiment provenance** — Git commit hash auto-captured per metric measurement
- **Noise-adaptive sampling** — CV (coefficient of variation) computed; warns when benchmark is too noisy
- **Multi-metric tracking** — Secondary metrics shown in context as sub-rows
- **Snapshot generation** — `AUTORESEARCH_STATE.json` written atomically on every context injection
- **Run duration tracking** — Per-run elapsed time shown in context
- **Stop summary reports** — `experiments/summary-{ts}.md` generated on loop stop
- **Context injection** — Auto-generated "Recently Tried" table + stats in `before_agent_start`
- **Deduplication hints** — Last 5 unique descriptions shown to prevent repeated hypotheses
- **Session persistence** — Consecutive discard and plateau counters survive session restarts via JSONL re-derivation
- **Strict start gate** — `/autoresearch start` refuses unresolved placeholders, empty scope, missing config, unconfigured benchmarks, non-runtime dirty files, and non-isolated git contexts

## Helper scripts

```bash
python scripts/autoresearch.py parse-metrics benchmark.out
python scripts/autoresearch.py validate autoresearch.jsonl
python scripts/autoresearch.py decide --direction lower --candidate 12.0 --best 12.8
python scripts/autoresearch.py dashboard autoresearch.jsonl --output autoresearch-dashboard.md
```

## Validation

```bash
npm ci
npm test
npm run typecheck
```

## License

MIT

# Autoresearch Skill

Bounded, benchmark-driven optimization loops for Pi Coding Agent and repository experiments.

Autoresearch helps an agent test one hypothesis at a time, compare measured results against a baseline and current best, keep only meaningful improvements, and preserve crash-safe state across long sessions.

## What this repository contains

- `SKILL.md` - ChatGPT/Pi skill entrypoint.
- `agents/openai.yaml` - ChatGPT skill UI metadata.
- `references/` - detailed protocols for state, benchmark decisions, safety, Pi extension behavior, and examples.
- `scripts/` - deterministic helpers for metric parsing, JSONL validation, decisions, and dashboard generation.
- `extension.ts` - optional Pi TUI integration for `/autoresearch` commands.
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

```bash
# Add this repository as a skill in the agent config.
skills:
  - path: GroepChef/autoresearch-skill
```

Optional Pi extension:

```bash
ln -s /path/to/autoresearch-skill/extension.ts ~/.pi/agent/extensions/autoresearch.ts
```

Commands:

```text
/autoresearch status
/autoresearch new <goal>
/autoresearch start [max_runs] [max_minutes]
/autoresearch pause
/autoresearch resume
/autoresearch dashboard
```

## Helper scripts

```bash
python3 scripts/autoresearch.py parse-metrics benchmark.out
python3 scripts/autoresearch.py validate autoresearch.jsonl
python3 scripts/autoresearch.py decide --direction lower --candidate 12.0 --best 12.8
python3 scripts/autoresearch.py dashboard autoresearch.jsonl --output autoresearch-dashboard.md
```

## Validation

```bash
npm install
npm test
npm run typecheck
```

## License

MIT

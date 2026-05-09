# Pi Extension

`extension.ts` adds optional Pi TUI integration for local autoresearch sessions.

## Commands

```text
/autoresearch status
/autoresearch new <goal>
/autoresearch start [max_runs] [max_minutes]
/autoresearch ralph [max_runs] [max_minutes]
/autoresearch pause
/autoresearch resume
/autoresearch dashboard
/autoresearch validate
```

## Behavior

- `status` reads JSONL and reports config, run count, best value, pause state, and parse errors.
- `new` scaffolds `autoresearch.md`, `autoresearch.sh`, and `experiments/worklog.md`.
- `start` begins an assisted loop with explicit run/time budgets.
- `ralph` begins a fully autonomous simple-hypothesis loop with tighter diff limits.
- `pause` writes `.autoresearch-off`.
- `resume` removes `.autoresearch-off`.
- `dashboard` renders recent run state from JSONL.
- `validate` reports JSONL validity and parse errors.

## Hardening rules

- Never hide JSONL parse errors.
- Never scaffold a fake `METRIC <name>=<value>` line as executable output.
- Never send literal unbounded loop instructions.
- Include resume context during compaction only when valid state exists.
- Require a clean git working tree before starting a loop.

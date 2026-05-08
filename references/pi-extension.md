# Pi Extension

`extension.ts` adds optional Pi TUI integration for local autoresearch sessions.

## Commands

```text
/autoresearch status
/autoresearch new <goal>
/autoresearch start [max_runs] [max_minutes]
/autoresearch pause
/autoresearch resume
/autoresearch dashboard
```

## Behavior

- `status` reads JSONL and reports config, run count, best value, pause state, and parse errors.
- `new` scaffolds `.agents/autoresearch/autoresearch.md`, `.agents/autoresearch/autoresearch.sh`, and `.agents/autoresearch/worklog.md`.
- `start` sends a bounded follow-up instruction with explicit run and time budgets.
- `pause` writes `.agents/autoresearch/.autoresearch-off`.
- `resume` removes `.agents/autoresearch/.autoresearch-off`.
- `dashboard` renders recent run state from JSONL.

## Hardening rules

- Never hide JSONL parse errors.
- Never scaffold a fake `METRIC <name>=<value>` line as executable output.
- Never send literal unbounded loop instructions.
- Include resume context during compaction only when valid state exists.

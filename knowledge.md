# Project knowledge

This file gives Codebuff context about your project: goals, commands, conventions, and gotchas.

## Quickstart

- **Setup**: copy `.env.example` to `.env.local`; use `bash scripts/bootstrap-env.sh` on Unix shells when environment bootstrap is needed.
- **Dev**: `npm run typecheck` to validate TypeScript.
- **Test**: `npm run validate` runs Python tests, TypeScript tests, and typecheck on Windows and Unix.

## Architecture

- **Key directories**:
  - `extensions/autoresearch/` - Core extension modules (commands, loop, policy, state, tools, ui, types)
  - `scripts/autoresearch.py` - Python helpers for metric parsing, validation, decisions, dashboard
  - `tests-ts/` - TypeScript test suite (unit + e2e)
  - `references/` - Design docs and protocols
  - `experiments/` - Autoresearch experiment output directory

- **Data flow**:
  1. User writes `.agents/autoresearch/autoresearch.md` with objective, metrics, run commands, scope
  2. `/autoresearch start` initializes JSONL state file
  3. Loop runs experiments, captures METRIC output, stores in JSONL
  4. `autoresearch_decide` tool evaluates results against benchmark policy
  5. `autoresearch_dashboard` generates markdown report from JSONL

## Commands

- `/autoresearch new` - Create new autoresearch context file
- `/autoresearch start [runs] [budget]` - Start optimization loop
- `/autoresearch pause` / `/autoresearch resume` - Pause/resume loop
- `/autoresearch status` - Show current state
- `/autoresearch dashboard` - Generate markdown dashboard
- `/autoresearch ralph [runs] [min]` - Fully autonomous naive-explorer mode
- `/autoresearch validate` - Validate JSONL state

## Tools (Pi Extension)

- `autoresearch_state` - Read and validate JSONL state
- `autoresearch_metric` - Parse METRIC lines from benchmark output
- `autoresearch_decide` - Policy-driven keep/discard/stop decision
- `autoresearch_dashboard` - Generate markdown dashboard from JSONL

## Conventions

- **Formatting**: No formatter/linter is configured; keep edits consistent with existing TypeScript and Python style.
- **Patterns**: Follow modular structure in extensions/autoresearch/
- **Safety**: All autonomous behavior bounded by run/time budgets; stops on corrupt/unsafe state

## Things to avoid

- Destructive operations without human approval
- Dirty git working tree when running loop
- Off-limits file edits exceeding diff size limits
- Running without configuring .env.local

## Key files

- `.agents/autoresearch/autoresearch.md` - User-defined context (objective, metrics, run commands, scope)
- `.agents/autoresearch/autoresearch.jsonl` - Append-only state log (config, results, decisions)
- `.agents/autoresearch/AUTORESEARCH_STATE.json` - Snapshot for quick resume
- `experiments/summary-{timestamp}.md` - Stop reports

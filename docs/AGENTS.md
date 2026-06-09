# Repository Guidelines

> Extended build/style notes. **Agent entry:** [`../AGENTS.md`](../AGENTS.md) — pre-context, skills registry, sub-agent matrix.

## Project Structure & Module Organization

This repository contains the **Autoresearch Skill** — a bounded, benchmark-driven optimization loop for the Pi Coding Agent. Key directories:

- `extensions/autoresearch/` — TypeScript Pi TUI plugin (entrypoint, commands, state, tools, policy, loop, ui, types).
- `scripts/` — Python helpers for metric parsing, JSONL validation, keep/discard decisions, and dashboard generation.
- `tests/` — Python regression tests for the helper scripts.
- `tests-ts/` — TypeScript tests for the Pi extension (tools, policy, loop, e2e).
- `references/` — Detailed protocol docs (state, benchmark policy, safety policy, Pi extension behavior, examples).
- `agents/` — OpenAI/YAML skill UI metadata.
- `types/` — TypeScript type declarations.

## Build, Test, and Development Commands

| Command | Purpose |
|---------|---------|
| `npm run typecheck` | TypeScript type checking (`tsc --noEmit`) |
| `npm test` | Run Python unit tests through the cross-platform Node wrapper |
| `npm run test:ts` | Run TypeScript tests through the cross-platform Node wrapper |
| `npm run validate` | Run Python tests, TypeScript tests, and `tsc --noEmit` |

## Coding Style & Naming Conventions

- **TypeScript**: Strict mode, NodeNext module resolution, ES2022 target. Use 2-space indentation. Prefer explicit types over inference for function signatures.
- **Python**: Use `snake_case` for functions and variables. Follow PEP 8 conventions.
- **Naming**: Filenames use `kebab-case.ts` (e.g., `benchmark-policy.md`, `run-ts-tests.sh`). Types in PascalCase, functions in camelCase for TS.
- **No linter** is configured, but `tsc --noEmit` enforces type correctness.

## Testing Guidelines

- **Python tests**: Use `unittest` framework, stored in `tests/test_*.py`. Run with `npm test`.
- **TypeScript tests**: Stored in `tests-ts/*.test.ts`. Run with `npm run test:ts`.
- **Naming**: Test files match the module under test (e.g., `test_autoresearch_helpers.py`, `tools.test.ts`).
- **Coverage**: No explicit coverage threshold, but correctness is enforced — any functional regression must be caught by the test suite before merging.

## Commit & Pull Request Guidelines

- **Commit messages**: Follow Conventional Commits format (e.g., `feat: add ralph mode`, `fix: handle empty metric output`, `docs: update benchmark policy`).
- **PR requirements**: Include a clear description of the change, reference related issues when applicable, and verify all validation checks pass (`npm run validate`). Keep diffs focused on a single concern.

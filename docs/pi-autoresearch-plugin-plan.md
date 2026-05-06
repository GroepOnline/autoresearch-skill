# Plan: Pi Autoresearch Plugin Package

Canonical execution plan: `~/.omc/plans/pi-autoresearch-plugin.md`

This repository-local copy exists so contributors can review the plugin conversion roadmap in the repo.

## Summary

Convert this repository from a skill plus optional single-file extension into a full Pi package/plugin:

- package manifest with Pi extension + skill resources;
- modular TypeScript extension;
- hook-based safety guards;
- bounded loop orchestration;
- custom autoresearch tools;
- Ralph Wiggum naive-explorer mode;
- tests and docs.

## Phases

1. Package manifest and compatibility layout.
2. Modularize extension internals without behavior changes.
3. Add TypeScript helper tests.
4. Add safety policy module and `tool_call` guards.
5. Add custom autoresearch tools.
6. Add loop orchestration state machine.
7. Add Ralph Wiggum mode.
8. Update documentation and examples.
9. Update validation/CI.
10. Final review and release prep.

## Safety stance

All autonomous behavior must remain bounded by explicit run/time budgets. The plugin must stop on corrupt state, unsafe git state, failing correctness checks, noisy metrics, off-limits diffs, pause sentinel, or exhausted budgets.

See the canonical plan for file-by-file implementation details and acceptance criteria.

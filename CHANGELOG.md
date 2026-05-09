# Changelog

All notable changes to the Autoresearch Skill project.

## [0.3.0] — 2026-05-09

### Fixed - Critical Issues from Audit

#### Dependency Management
- **Pin peerDependency** - Changed `@mariozechner/pi-coding-agent` from `*` to `^0.74.0` to prevent breaking changes.

#### State Management
- **Eliminate global state** - Moved `currentMaxDiffLines` from module-level singleton to `LoopState.maxDiffLines` for proper session isolation.
- **Add experiments cleanup** - Implemented automatic cleanup of old summary files (keep last 50, max 30 days).

#### Error Handling
- **Add proper logging** - Replaced all silent `catch { /* best-effort */ }` blocks with proper `console.error` logging for production debugging.
- **Input validation** - Added comprehensive input validation to `autoresearch_metric` and `autoresearch_decide` tools with clear error messages.

#### Security
- **Security audit logging** - Added `.autoresearch-audit.jsonl` logging for all security blocks in tool_call guard.
- **Tool call validation** - Enhanced `evaluateToolCall` with `maxDiffLines` parameter for session-specific diff size limits.

#### Configuration
- **Configurable thresholds** - Added `max_consecutive_discards`, `max_runs_without_improvement`, `max_diff_lines_assisted`, `max_diff_lines_ralph` to `ArConfig`.

### Changed
- Updated `LoopState` interface to include `maxDiffLines` field.
- Updated test fixtures to include new required `maxDiffLines` field.
- All catch blocks now log errors to stderr instead of silently swallowing them.

## [0.2.0] — Unreleased

### Added

#### Commands
- `/autoresearch ralph [runs] [min]` — Fully autonomous naive-explorer mode. Simplest hypotheses first, max ~10 line diffs, runs until budget or safety stop.
- `/autoresearch validate` — Validate `autoresearch.jsonl` and report errors, run count, and decision count.

#### Custom Tools (Pi Extension)
- `autoresearch_state` — Read and validate JSONL state (config, runs, best, baseline).
- `autoresearch_metric` — Parse METRIC lines from benchmark output, compute median + noise CV, capture git commit.
- `autoresearch_decide` — Policy-driven keep/discard/stop decision against current best.
- `autoresearch_dashboard` — Generate markdown dashboard from JSONL.

#### Safety Hardening (#1-3)
- **Consecutive discards stop** — Loop stops after 5 consecutive discards to avoid wasting budget on dead-end exploration.
- **Git isolation** — Loop refuses to start when the working tree is dirty outside `autoresearch.md` and `experiments/`.
- **Decide alignment** — JSONL-based keep/discard decisions aligned with benchmark policy, not heuristic.

#### Automation & Context (#4-6)
- **Worklog/context auto-generation** — "Recently Tried" table auto-generated from JSONL; no manual worklog maintenance required.
- **Deduplication hints** — Last 5 unique experiment descriptions shown in context injection to prevent repeated hypotheses.
- **Context injection** — Stats + recently tried table injected on `before_agent_start` hook.

#### State Management (#7-8)
- **Snapshot generation** — `AUTORESEARCH_STATE.json` written on every context injection for quick resume.
- **Plateau detection** — Loop stops after 10 runs without improvement (configurable via JSONL re-derivation on restart).

#### Experiment Quality (#9-11)
- **Experiment provenance** — `autoresearch_metric` auto-captures git HEAD commit hash; shown in context injection table.
- **Noise-adaptive sampling** — CV (coefficient of variation) computed from samples; warns when benchmark noise exceeds `noise_floor_pct` (default 5%).
- **Multi-metric tracking** — Secondary metrics (`memory_mb`, `size_kb`, etc.) shown as sub-rows in context injection.

#### Operational Hardening (#12-14)
- **Run duration tracking** — Per-run elapsed time shown as "Laatste run: Xs" in context injection.
- **Stop summary reports** — `experiments/summary-{timestamp}.md` generated on loop stop with stats + recent results.
- **Diff-size enforcement** — `policy.ts` blocks write/edit/str_replace exceeding mode-specific limits (50 lines assisted, 10 lines Ralph).

### Changed
- Refactored extension into modular files: `commands.ts`, `loop.ts`, `policy.ts`, `state.ts`, `tools.ts`, `ui.ts`, `types.ts`.
- Updated CI (`validate.yml`) to run TypeScript tests in addition to Python tests and typecheck.
- Added comprehensive README and SKILL.md documentation covering all features.

## [0.1.0] — Initial release

- Bounded, benchmark-driven optimization loops for Pi Coding Agent.
- `/autoresearch status|new|start|pause|resume|dashboard` commands.
- Append-only JSONL state protocol.
- Median-based benchmark policy with noise checks.
- Python helper scripts for metric parsing, validation, decisions, and dashboards.
- Safety policy: git operation bounds, destructive operation rules, scope limits.

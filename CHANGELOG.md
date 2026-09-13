# Changelog

All notable changes to the Autoresearch Skill project.

## [Unreleased]

## [1.5.0] - 2026-09-13

### Fixed
- scan all subjects before choosing minor (#20)
## [1.4.0] - 2026-09-12

### Added
- per-package preview container via npm artifact + smoke test (#17)

### Fixed
- type the unpinned version assertion as string (#19)
- unpin package version assertion (releases bump it) (#18)
## [1.3.0] - 2026-09-12

### Changed
- Package is now published as `@groeponline/pi-autoresearch`: the unscoped `pi-autoresearch` name is owned by an unrelated publisher on npm. The agent skill id (`pi-autoresearch`) is unchanged.
- Release pipeline: pushes to `main` now cut a tag and publish to npm automatically (org policy: +0.1 minor per change, major only for breaking).

## [1.2.0] — 2026-05-08

### Added

#### Commands

- **Quit command** — New `/autoresearch quit` command to immediately stop the autoresearch loop and clear loop state
- **Ultra-extended fullscreen dashboard** — New `/autoresearch dashboard --fullscreen` (or `-f`) option with 10 comprehensive panes

#### UI Improvements

- **Ultra-extended 10-pane fullscreen dashboard** — Massive enhancement with organized sections:
  - **Pane 1: Session Information** — Name, metric, unit, creation date, status, and momentum tracking
  - **Pane 2: Performance Overview** — Total runs, kept/discarded/crashed counts with visual progress bars, min/max metrics
  - **Pane 3: Success Analytics** — Success/improvement rates with progress bars, recent trend, streak tracking with emoji, consistency/volatility metrics
  - **Pane 4: Performance Trend Chart** — ASCII line chart showing last 25 runs with visual performance trends
  - **Pane 5: Time-Series Analysis** — Last 5/10 run averages, total improvement, improvement per run, period comparisons
  - **Pane 6: Results History** — Enhanced table with last 15 results, status indicators, delta calculations
  - **Pane 7: Decision Analysis** — Total/keep/discard/stop decisions, recent decision history with reasons
  - **Pane 8: Command Reference** — Complete list of available autoresearch commands
  - **Pane 9: Statistics Summary** — Total decisions, parse errors, ideas file presence, data quality indicators
  - **Pane 10: System Health Status** — Overall health score with progress bar, data integrity, stability, progress indicators

#### Advanced Analytics

- **Enhanced statistics engine** — Expanded `calculateStatistics()` function with 20+ metrics:
  - Success/improvement/crash/discard rates
  - Average/median/std deviation metrics
  - Min/max metric tracking
  - Recent 5/10 run averages
  - Total and average improvement per run
  - Momentum calculation (Strong Up/Gaining/Losing/Stable)
  - Consistency score (inverse coefficient of variation)
  - Volatility index (std dev relative to range)
  - Best and current keep streaks
  - Recent trend analysis (Improving/Declining/Stable)

#### Visual Enhancements

- **ASCII chart generation** — `generateAsciiChart()` function creates visual line charts for performance trends
- **Progress bar visualization** — `generateProgressBar()` function creates visual progress bars for percentages
- **Enhanced emoji integration** — 🔥 for best streak, ⚡ for current streak, 🚀 for strong momentum, 📈/📉 for trends
- **Visual status indicators** — ✓/✗ for boolean states, health scores with progress bars
- **Professional box-drawing layout** — Consistent pane separation with Unicode box characters

### Changed

- Updated command descriptions to include new `--fullscreen` option for ultra-extended dashboard
- Updated help text to reflect new quit command and ultra-extended dashboard
- Enhanced all dashboard layouts to provide comprehensive analytics at a glance
- Improved visual consistency across all UI elements with enhanced emoji icons and structured layouts
- Expanded statistics calculation for deeper insights into autoresearch performance

### Documentation

- Moved AGENTS.md, AUDIT.md, E2E_TESTING.md, and knowledge.md to docs/ directory
- Updated README.md with new commands and dashboard documentation
- Updated SKILL.md with new commands
- Updated package.json files array to reflect new documentation structure
- Updated test references to moved documentation files

## [1.1.0] — 2026-05-08

### Added

#### Benchmarking & Comparison

- **Code quality benchmark** — New `npm run benchmark` command measuring TypeScript compilation time, test execution time, code size metrics, test file count, and dependency counts
- **System comparison benchmark** — New `npm run benchmark:comparison` command comparing Pi Autoresearch with Factory.ai's Droid Autoresearch across 15 weighted criteria
- **Comparison methodology documentation** — Comprehensive documentation in `docs/comparison-methodology.md` explaining comparison criteria, scoring methodology, and interpretation

#### Artifact Management

- **Artifact layout migration** — All autoresearch artifacts now centralized in `.agents/autoresearch/` directory instead of scattered in repo root
- **Automatic migration logic** — `ensureArtifactsLayout()` function automatically migrates existing artifacts from old `.autoresearch/` directory and root-level files to new layout
- **Finalize command** — New `/autoresearch finalize [--archive]` command for cleanup and archiving of autoresearch artifacts
- **Archive functionality** — `archiveArtifacts()` function creates timestamped archives in `experiments/archive/<timestamp>/` with all artifact files

#### Testing

- **Comparison tests** — New test suite in `tests-ts/comparison.test.ts` validating comparison benchmark functionality
- **Commands tests** — New test suite in `tests-ts/commands.test.ts` testing archiveArtifacts functionality

### Changed

#### Artifact Layout

- All runtime artifacts moved from repo root to `.agents/autoresearch/` directory:
  - `autoresearch.md` → `.agents/autoresearch/autoresearch.md`
  - `autoresearch.jsonl` → `.agents/autoresearch/autoresearch.jsonl`
  - `AUTORESEARCH_STATE.json` → `.agents/autoresearch/AUTORESEARCH_STATE.json`
  - `autoresearch-dashboard.md` → `.agents/autoresearch/autoresearch-dashboard.md`
  - `autoresearch.ideas.md` → `.agents/autoresearch/autoresearch.ideas.md`
  - `experiments/worklog.md` → `.agents/autoresearch/worklog.md`
  - `.autoresearch-off` → `.agents/autoresearch/.autoresearch-off`
  - `autoresearch.sh` → `.agents/autoresearch/autoresearch.sh`

#### Documentation Updates

- Updated README.md with new benchmark sections and artifact layout documentation
- Updated SKILL.md with new artifact paths
- Updated all documentation references to reflect `.agents/autoresearch/` layout
- Added `.agents/autoresearch/` to `.gitignore`

### Fixed

#### Migration

- Safe migration logic with error handling for moving artifacts from old locations
- Graceful handling of missing files during migration
- Prevention of overwriting existing files during migration

## [1.0.0] — 2026-05-08

### Added

#### Commands

- `/autoresearch ralph [runs] [min]` — Fully autonomous naive-explorer mode. Simplest hypotheses first, max ~10 line diffs, runs until budget or safety stop.
- `/autoresearch validate` — Validate `autoresearch.jsonl` and report errors, run count, and decision count.

#### Custom Tools (Pi Extension)

- `autoresearch_state` — Read and validate JSONL state (config, runs, best, baseline).
- `autoresearch_metric` — Parse METRIC lines from benchmark output, compute median + noise CV, capture git commit.
- `autoresearch_decide` — Policy-driven keep/discard/stop decision against current best.
- `autoresearch_dashboard` — Generate markdown dashboard from JSONL.

#### Safety Hardening

- **Consecutive discards stop** — Loop stops after 5 consecutive discards to avoid wasting budget on dead-end exploration.
- **Git isolation** — Loop refuses to start when the working tree is dirty outside `autoresearch.md` and `experiments/`.
- **Decide alignment** — JSONL-based keep/discard decisions aligned with benchmark policy, not heuristic.

#### Automation & Context

- **Worklog/context auto-generation** — "Recently Tried" table auto-generated from JSONL; no manual worklog maintenance required.
- **Deduplication hints** — Last 5 unique experiment descriptions shown in context injection to prevent repeated hypotheses.
- **Context injection** — Stats + recently tried table injected on `before_agent_start` hook.

#### State Management

- **Snapshot generation** — `AUTORESEARCH_STATE.json` written on every context injection for quick resume.
- **Plateau detection** — Loop stops after 10 runs without improvement (configurable via JSONL re-derivation on restart).

#### Experiment Quality

- **Experiment provenance** — `autoresearch_metric` auto-captures git HEAD commit hash; shown in context injection table.
- **Noise-adaptive sampling** — CV (coefficient of variation) computed from samples; warns when benchmark noise exceeds `noise_floor_pct` (default 5%).
- **Multi-metric tracking** — Secondary metrics (`memory_mb`, `size_kb`, etc.) shown as sub-rows in context injection.

#### Operational Hardening

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

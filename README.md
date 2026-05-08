# Pi Autoresearch Extension

A full **Pi package** for bounded, benchmark-driven repository optimization. It ships both:

- a native Pi extension with commands, tools, lifecycle hooks, context injection, and safety guards;
- an Agent Skill under `skills/autoresearch/` for progressive workflow guidance.

Autoresearch helps a coding agent run controlled optimization experiments: establish a baseline, test one hypothesis, benchmark repeatedly, keep only meaningful improvements, and stop when budget, safety, or quality gates are hit.

## Package layout

```text
pi-autoresearch/
├── package.json                         # Pi package manifest
├── extensions/autoresearch/             # Native Pi extension
│   ├── index.ts                         # Extension entrypoint
│   ├── commands.ts                      # /autoresearch command router
│   ├── tools.ts                         # LLM-callable autoresearch tools
│   ├── policy.ts                        # Git, scope, bash and mutation guards
│   ├── state.ts                         # JSONL parsing, snapshots, context injection
│   ├── loop.ts                          # Assisted/Ralph continuation policy
│   └── ui.ts                            # Status/footer/dashboard text
├── skills/autoresearch/SKILL.md         # Pi/Agent Skill entrypoint
├── references/                          # Protocol, benchmark and safety references
├── scripts/autoresearch.py              # Deterministic helper CLI
├── tests/                               # Python helper tests
└── tests-ts/                            # Extension behavior tests
```

`extension.ts` remains as a compatibility shim for older direct-extension installs.

## Install

From GitHub:

```bash
pi install git:https://github.com/OnlineChef/autoresearch-skill
```

From a local checkout:

```bash
pi install /path/to/pi-autoresearch
```

For quick one-off extension testing:

```bash
pi -e /path/to/pi-autoresearch/extensions/autoresearch/index.ts
```

For npm packaging:

```bash
npm ci
npm run validate
npm run package
pi install ./dist/pi-autoresearch-1.0.0.tgz
```

## Pi resources

`package.json` declares the package as a Pi package:

```json
{
  "keywords": ["pi-package", "pi-extension", "pi-skill"],
  "pi": {
    "extensions": ["./extensions/autoresearch/index.ts"],
    "skills": ["./skills"]
  }
}
```

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

### Modes

- **Assisted mode**: `/autoresearch start` starts a bounded loop with user-visible context injection and budget tracking.
- **Ralph mode**: `/autoresearch ralph` starts an autonomous naive-explorer mode for tiny, simple hypotheses. It limits diff size and stops aggressively on safety or quality failures.

## Tools exposed to Pi

| Tool | Purpose |
| --- | --- |
| `autoresearch_state` | Read and validate `autoresearch.jsonl`, config, baseline, best result and run history. |
| `autoresearch_metric` | Parse `METRIC name=value direction=lower|higher` benchmark output and calculate summary/noise data. |
| `autoresearch_decide` | Decide `baseline`, `keep`, `discard`, or `stop` using metric direction, effect-size threshold, noise floor and correctness result. |
| `autoresearch_dashboard` | Generate a markdown dashboard from append-only state. |

## Runtime files created in target repositories

```text
autoresearch.md
autoresearch.jsonl
AUTORESEARCH_STATE.json
autoresearch-dashboard.md
autoresearch.ideas.md
experiments/worklog.md
experiments/summary-{timestamp}.md
.autoresearch-off
```

These files are created in the target project, not in this package repository.

## Safety model

Autoresearch is intentionally bounded. It stops or blocks continuation on:

- corrupt or oversized JSONL state;
- missing or unresolved experiment contract;
- dirty git state outside autoresearch runtime artifacts;
- non-isolated git context unless `/autoresearch new` can create an `autoresearch/*` branch;
- protected/off-limits path writes;
- destructive git or shell commands;
- post-run diff violations, including shell-created files outside scope;
- failed correctness checks;
- noisy benchmark results;
- exhausted run/time budget;
- five consecutive discards;
- plateau after ten runs without improvement;
- explicit `.autoresearch-off` pause sentinel.

## Benchmark contract

The default generated benchmark script is `./autoresearch.sh`. It must print at least one parseable metric line:

```text
METRIC run_seconds=1.234 direction=lower
```

For stable decisions, use multiple samples, compare against the current best, and treat correctness as a hard guardrail.

## Helper CLI

```bash
python scripts/autoresearch.py parse-metrics benchmark.out
python scripts/autoresearch.py validate autoresearch.jsonl
python scripts/autoresearch.py decide --direction lower --candidate 12.0 --best 12.8
python scripts/autoresearch.py dashboard autoresearch.jsonl --output autoresearch-dashboard.md
```

## Validate

```bash
npm ci
npm run validate
```

The validation suite runs:

- Python helper tests;
- TypeScript extension behavior tests;
- ESLint;
- TypeScript typecheck.

## Release checklist

```bash
npm ci
npm run validate
npm run package
npm publish --access public
```

Before publishing, verify the repository URL, package owner, changelog and npm permissions.

## License

MIT

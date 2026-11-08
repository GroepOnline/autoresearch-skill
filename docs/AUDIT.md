# Autoresearch Extension Audit

Date: 2026-05-08
Scope: uploaded `GroepOnline/autoresearch-skill` source archive.

## Executive summary

The repository has been upgraded from a skill-first archive into a complete Pi package:

- Native extension entrypoint: `extensions/autoresearch/index.ts`
- Pi package manifest: `package.json > pi.extensions` and `package.json > pi.skills`
- Agent Skill entrypoint: `skills/autoresearch/SKILL.md`
- Compatibility root skill: `SKILL.md`
- Deterministic helper CLI: `scripts/autoresearch.py`
- Safety, policy, state, loop and UI modules
- Python and TypeScript regression tests
- Clean npm tarball packaging

## Original issues found

| Area            | Issue                                                                                                                 | Risk                                                                                             | Fix                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Product shape   | Repository still presented itself primarily as a skill.                                                               | User expectation was a full `pi.dev` extension/package.                                          | Repositioned README and package metadata around Pi package + native extension.                 |
| Pi layout       | Skill lived only at repository root with `pi.skills: ["."]`.                                                          | Works as a manifest path, but is less conventional and easy to confuse with a pure skill upload. | Added `skills/autoresearch/SKILL.md` and changed manifest to `pi.skills: ["./skills"]`.        |
| Packaging       | `scripts/package-clean.mjs` crashed after `npm pack` because it expected `stdout` while running with inherited stdio. | Release command failed after producing the tarball.                                              | Made packaging script tolerate inherited stdio and return a stable tarball path.               |
| Metadata        | `private: true` and old `GroepChef` repository URL conflicted with distributable package intent.                      | Package could not be published cleanly and pointed to the wrong GitHub org.                      | Removed private flag and updated repository/homepage/bugs to `OnlineChef`.                     |
| Discoverability | Keywords were minimal.                                                                                                | Pi package catalog/npm discovery weaker.                                                         | Added `pi-package`, `pi-extension`, `pi-skill`, `agent-skill`, `optimization`, `coding-agent`. |
| Docs            | README install commands and project description were still skill-oriented.                                            | Users would install or evaluate it as the wrong artifact type.                                   | Rewrote README around extension commands, tools, hooks, runtime files and release flow.        |
| Validation      | Tests existed but final packaging was not part of a clean release path.                                               | A green test suite could still leave a broken package command.                                   | Re-ran validation and fixed package generation.                                                |

## Architecture review

### Strong points retained

- Append-only `autoresearch.jsonl` state model.
- Snapshot generation via `AUTORESEARCH_STATE.json`.
- Explicit contract file via `autoresearch.md`.
- Hard stop conditions for corrupt state, unsafe git state, noisy benchmarks and budget exhaustion.
- Separate modules for commands, policy, loop evaluation, state parsing, tools and UI.
- TypeScript tests for command/tool/loop/policy/state behavior.
- Python helper parity tests.

### Notable improvements applied

1. **Pi package structure**
   - `package.json` now explicitly declares the extension and skill locations.
   - The skill is placed under `skills/autoresearch/` for standard package discovery.

2. **Release readiness**
   - Package is no longer marked private.
   - `npm run package` produces `dist/pi-autoresearch-1.0.0.tgz`.
   - Final zip includes source, tests, docs and generated package tarball.

3. **Safety clarity**
   - README now documents exact stop/block conditions.
   - Runtime artifacts are clearly separated from package files.

4. **User-facing clarity**
   - Install, local testing, npm packaging and Pi commands are documented directly.
   - Tool contracts are described in a concise table.

## Validation results

Commands run:

```bash
npm ci
npm run test
npm run test:ts
npm run lint
npm run typecheck
npm run package
```

Result:

- Python helper tests: pass
- TypeScript extension tests: pass
- ESLint: pass
- TypeScript typecheck: pass
- npm pack: pass

## Remaining publish-time checks

Before public npm release:

1. Confirm the desired npm package owner/scope.
2. Confirm whether the package should stay unscoped as `pi-autoresearch` or become scoped, e.g. `@onlinechef/pi-autoresearch`.
3. Add screenshots or demo video metadata under `pi.image` or `pi.video` if submitting to the Pi package gallery.
4. Tag the GitHub release after publishing the npm package.

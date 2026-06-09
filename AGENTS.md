# AGENTS.md — autoresearch-skill

> Bounded benchmark-driven optimization loop for the Pi Coding Agent — TypeScript extension + Python helpers.

## Pre-context (read first)

**Autoresearch Skill** runs keep/discard optimization loops against a fixed benchmark policy. Pi TUI plugin lives in `extensions/autoresearch/`; protocol detail in `references/`. Safety and benchmark rules are non-negotiable.

| Rule | Detail |
|------|--------|
| **SSOT** | `extensions/autoresearch/` — loop, policy, tools, state |
| **Protocol docs** | `references/benchmark-policy.md`, `references/safety-policy.md`, `references/state-protocol.md` |
| **Skill manifest** | `skills/autoresearch/SKILL.md` + root `SKILL.md` |
| **Never** | Bypass safety policy; widen benchmark scope mid-loop; skip `npm run validate` before PR |

## Skills (install paths)

| Task | Skill path |
|------|------------|
| **Autoresearch loop** | `skills/autoresearch/SKILL.md` |
| **E2E harness** | `.agents/skills/autoresearch-e2e/SKILL.md` |
| **Taste (UI skills)** | `../skill-grinder/skills/taste-skill/SKILL.md` · `.claude/skills/taste-skill/` |
| **123-skill registry** | `../agent-skill-quality/registry/skills.yaml` |
| **Pi extension patterns** | `references/pi-extension.md` |

## Skills registry

| Asset | Path |
|-------|------|
| Primary skill | `skills/autoresearch/SKILL.md` |
| Extension entry | `extensions/autoresearch/index.ts` |
| Org flat registry | `../agent-skill-quality/registry/skills.yaml` (123 skills) |
| Grinder canonical tree | `../skill-grinder/skills/` (169 skills) |

## Sub-agents

| Role | When | Spawn focus |
|------|------|-------------|
| **grinder** | Skill manifest drift, grinder score on `SKILL.md` | `../skill-grinder/bin/grinder.mjs score autoresearch` |
| **scorer** | Benchmark regression, metric parsing | `scripts/autoresearch.py`, `scripts/benchmark-comparison.mjs`, `tests/` |
| **improver** | Loop/policy tuning, keep-discard logic | `extensions/autoresearch/loop.ts`, `lib/runner.mjs`, `references/` |
| **notion-sync** | CHEF doc sync after release | `.github/workflows/chef-linear-notion-sync.yml`, `../OrgBeheer/runbooks/chef-dev-sync.md` |

**Team size:** 2–3 parallel subagents for extension + script + test changes.

## Verify

```bash
npm run validate    # Python tests + TS tests + tsc --noEmit
npm run typecheck
npm test && npm run test:ts
```

Extended agent notes: [`docs/AGENTS.md`](docs/AGENTS.md)

## CHEF

- **Branch:** `CHEF-<n>-short-slug` or `chore/agent-fleet-a3-skills`
- **Commit:** `feat: … CHEF-<n>` · **PR:** `Fixes CHEF-<n>`
- **Team:** https://linear.app/chefgroep/team/CHEF

## Project structure

```
autoresearch-skill/
├── extensions/autoresearch/   # Pi TUI plugin (loop, policy, tools, ui)
├── scripts/                 # Python helpers, benchmark parsers
├── tests/                   # Python regression tests
├── tests-ts/                # TypeScript extension tests
├── references/              # Protocol docs (state, safety, benchmark)
├── skills/autoresearch/     # Skill manifest
└── docs/AGENTS.md           # Extended build/style guidelines
```
# Development environment

This repo-local environment package was added for new-repository bootstrap on 2026-05-06. It is intentionally non-invasive: it documents local setup, safe automation defaults, and AI/cloud placeholders without committing secrets or destructive automation.

## Repository profile

- Repository: [GroepChef/autoresearch-skill](https://github.com/GroepChef/autoresearch-skill)
- Created: 2026-05-05T22:42:55Z
- Visibility: INTERNAL
- Classified stack: TypeScript skill scaffold / AI agent research loop
- Primary workflow: multi-model AI research skill and experiment loop

## Prerequisites

- Node.js 22+ and npm (detected package.json). Run `npm ci` when package-lock.json is present.
- GitHub CLI (`gh`) for issue/project/repo automation when needed.
- Bash for `scripts/bootstrap-env.sh`.
- Playwright/Chromium is optional for computer-use experiments. Install it only in branches that actually add browser tests or automation.

## Quick start

```bash
cp .env.example .env.local
bash scripts/bootstrap-env.sh
```

The bootstrap script is idempotent and safe by default. It creates local artifact/state directories, validates placeholder configuration, and prints stack-specific next steps. It does not install global tools, change repository settings, deploy, merge, delete, or archive anything.

## Secret handling

- Keep real API tokens in `.env.local`, GitHub Actions secrets, Codespaces secrets, or your platform secret store.
- Never commit `.env.local`, screenshots containing credentials, or generated logs with raw prompts/secrets.
- Leave `.env.example` as placeholders only.

## Cloud AI and model selection

The repo supports provider-neutral placeholders in `.env.example`:

- `AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
- rate limits and timeouts (`AI_RATE_LIMIT_RPM`, `AI_REQUEST_TIMEOUT_MS`)

Use `AI_PROVIDER=stub` for local dry runs. Switch providers only after secrets are configured outside Git.

## Computer-use safety defaults

Computer-use automation must start with:

- `DRY_RUN=true`
- `COMPUTER_USE_ENABLED=false` until explicitly needed
- allowlisted domains only (`COMPUTER_USE_ALLOWED_DOMAINS`)
- bounded steps (`MAX_AGENT_STEPS`, `COMPUTER_USE_MAX_STEPS`)
- redacted screenshots and artifacts under `.artifacts/`
- human approval for destructive actions

If Playwright/Chromium becomes necessary, install it in the existing ecosystem for the repo and document the exact command in the PR that adds browser automation.

## Validation

Run:

```bash
bash -n scripts/bootstrap-env.sh
bash scripts/bootstrap-env.sh
```

The optional environment-check workflow uses only shell steps and local repository files, so it has no third-party GitHub Action pins to maintain.

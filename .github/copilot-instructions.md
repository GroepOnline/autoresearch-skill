# Copilot instructions

Repository: GroepChef/autoresearch-skill
Stack classification: TypeScript skill scaffold / AI agent research loop

When contributing here:

- Keep changes surgical and repo-local.
- Do not commit secrets, `.env.local`, raw screenshots, or unredacted AI logs.
- Default autonomous/cloud AI flows to dry-run mode with human approval for destructive actions.
- Prefer updating docs, issues, state, or checklists over making risky configuration changes.
- If adding GitHub Actions `uses:` steps, pin each external action to a full 40-character commit SHA.
- For computer-use/browser automation, use allowlisted domains, step limits, redacted screenshots, and artifact paths documented in `.env.example`.
- Coordinate agent/catalog assumptions with the organization control-plane and private custom-agent catalog when relevant, but do not block local validation on remote catalog availability.

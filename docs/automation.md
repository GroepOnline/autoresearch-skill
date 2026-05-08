# Automation and hooks

Automation in this repository is report-only and human-reviewed by default. It is suitable for cloud AI workflows and computer-use apps without introducing destructive behavior.

## Safe automation policy

Autonomous agents and scheduled workflows may:

- validate environment files and docs;
- create or update checklists, issues, and status reports;
- collect non-secret repository metadata;
- write artifacts under `.artifacts/` or state under `.state/` when those paths are ignored.

Autonomous agents and scheduled workflows must not, without explicit approval:

- merge pull requests;
- delete branches, tags, files, packages, or repositories;
- archive repositories;
- change production secrets or organization policy;
- deploy to production;
- bypass branch protection.

## Recommended local hooks

Use the bootstrap script as a preflight:

```bash
bash scripts/bootstrap-env.sh
```

For Git hooks, prefer local-only hooks managed by each contributor (for example via `core.hooksPath`) and keep them report-only. Do not add hooks that mutate history or perform network calls without a clear opt-in.

## Cloud AI workflow checklist

- [ ] `.env.local` exists locally and is untracked.
- [ ] Provider secrets are stored outside Git.
- [ ] `DRY_RUN=true` for first execution.
- [ ] model/provider/rate-limit values are documented in the run log.
- [ ] artifacts and screenshots are redacted before sharing.
- [ ] destructive actions require a human approval checkpoint.

## Computer-use checklist

- [ ] enable only for an explicit task (`COMPUTER_USE_ENABLED=true`).
- [ ] keep domain allowlists narrow.
- [ ] cap max steps and tool calls.
- [ ] store screenshots under `.artifacts/screenshots`.
- [ ] redact secrets from screenshots/logs.
- [ ] review results before applying changes.

## GitHub Actions pinning

If future workflows add `uses:` steps, pin every external action to a full 40-character commit SHA. Local shell-only workflows are preferred for simple environment drift checks.

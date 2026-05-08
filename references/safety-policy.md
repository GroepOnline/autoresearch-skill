# Safety Policy

Autoresearch must be autonomous inside narrow boundaries, not unbounded or destructive.

## Required stop conditions

Stop immediately when any condition applies:

- dirty git state outside the autoresearch runtime workspace at start
- state file corruption
- missing or failing baseline
- benchmark output has no parseable primary metric
- tests fail for a candidate change
- configured max runs or max minutes reached
- repeated discards reach the configured limit
- benchmark noise remains above threshold
- candidate diff touches off-limits paths
- candidate diff includes secrets, credentials, tokens, or key material

## Git isolation

Avoid this pattern:

```bash
git reset --hard HEAD~
```

Use safer options:

- create a dedicated branch for the experiment session (prefix `autoresearch/`)
- use `git worktree` per candidate run when available
- restrict restore/clean operations to allowlisted files and generated paths
- record the base commit in state before changing files

The extension start gate enforces this: starting on `main`/`master` or any non-isolated branch is blocked unless it can auto-switch to `autoresearch/<goal>`.

Recommended discard pattern:

```bash
git restore --source=HEAD --staged --worktree -- <allowlisted-files>
git clean -fd -- <allowlisted-generated-paths>
```

## Diff limits

The extension checks direct write/edit tools before execution and audits the actual git diff after each agent turn. This post-run audit catches shell-driven mutations such as `python -c`, `sed -i`, `cat > file`, or other bash commands that change files outside the declared scope.

Defaults:

- one hypothesis per run
- max 20 changed logical lines unless explicitly configured
- no dependency changes unless the experiment contract allows them
- no lockfile changes unless dependency changes are in scope
- no production config or secret changes

## Pause sentinel

When `.agents/autoresearch/.autoresearch-off` exists, finish the current safe checkpoint and stop before starting the next run.

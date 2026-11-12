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

Not all of these are enforced by `evaluateContinuation`. Budget exhaustion, state corruption, the consecutive-discard limit, the plateau limit, the pause sentinel, and a recorded `stop` decision stop the loop automatically; the other items are obligations on the agent, which must record a `stop` decision (or the gate blocks the offending write). See the "Safety model" section in `README.md` for which mechanism enforces which condition.

## Git isolation

Avoid this pattern:

```bash
git reset --hard HEAD~
```

Use safer options:

- create a dedicated branch for the experiment session (prefix `autoresearch/`)
- use `git worktree` per candidate run when available
- record the base commit in state before changing files
- discard by recording the decision and leaving the tree untouched; revert by hand outside the guarded loop

The extension start gate enforces this: starting on `main`/`master` or any non-isolated branch is blocked unless it can auto-switch to `autoresearch/<goal>`.

Discard pattern inside the loop: there is none. `ALLOWED_COMMAND_WHITELIST` in `extensions/autoresearch/policy.ts` (line 104) admits only read-only git subcommands:

```ts
["git", /^(?:status|log(?:\s+[\w./=-]+)*|diff(?:\s+[\w./=-]+)*|show(?:\s+[\w./=-]+)*|branch(?:\s+[\w./=-]+)*|rev-parse(?:\s+[\w./=-]+)*|ls-files(?:\s+[\w./=-]+)*|ls-tree(?:\s+[\w./=-]+)*)$/]
```

Every other subcommand fails the whitelist and is blocked with `command not in whitelist: git`. That includes path-limited forms such as `git clean -fd -- <paths>`, `git restore --source=HEAD --staged --worktree -- <paths>`, `git checkout -- <paths>`, and `git reset --hard`. There is no discard tool either, so an agent that follows this document cannot revert the working tree from inside the loop.

Consequence for the loop: a discard is recorded in `autoresearch.jsonl` and the candidate stays in the working tree. The revert happens when a human runs git in their own terminal, or by throwing the run branch/worktree away. Do not promise an agent-driven `git clean`/`git restore` step.

## Diff limits

`currentMaxDiffLines` in `extensions/autoresearch/policy.ts` (line 37) is module-level state:

```ts
let currentMaxDiffLines = 50; // Ralph mode sets this to 10; assisted mode to 50
```

The start commands set it explicitly: `setMaxDiffLines(50)` for assisted mode (`commands.ts` line 339) and `setMaxDiffLines(10)` for Ralph mode (`commands.ts` line 384). A value of `0` or lower disables the check (`policy.ts` line 469: `if (currentMaxDiffLines <= 0) return { block: false };`). The `max_diff_lines_assisted` / `max_diff_lines_ralph` fields in `types.ts` are declared but not read by any code path, so there is no config override today.

Two checks use that limit:

1. Pre-execution (`evaluateDiffSize`, `policy.ts` line 468): applies only to `write`, `edit`, and `str_replace` tool calls, and counts the lines of the submitted payload, not of the resulting git diff.
2. Post-run (`evaluateWorkingTreeMutation`, `policy.ts` line 702, called after every agent turn): counts added-plus-deleted lines from `git diff --numstat` across every dirty non-runtime path, checks each path against the contract, and blocks further bash/file mutations until the diff is reduced. This is the check that catches shell-driven mutations such as `python -c`, `sed -i`, `cat > file`, or other bash commands that change files outside the declared scope.

Tool calls blocked by the pre-execution check are appended to `.autoresearch-audit.jsonl` in the working directory as redacted `security_block` entries (timestamp, tool name, reason, redacted path/command preview). The log never stores file contents or credential-shaped values.

Defaults:

- one hypothesis per run
- max 50 changed lines in assisted mode and 10 in Ralph mode, counted as diff added+deleted lines, not "logical lines"
- no dependency changes unless the experiment contract allows them
- no lockfile changes unless dependency changes are in scope
- no production config or secret changes

## Pause sentinel

When `.autoresearch/.autoresearch-off` exists, finish the current safe checkpoint and stop before starting the next run.

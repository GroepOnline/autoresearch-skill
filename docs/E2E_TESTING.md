# E2E Testing Guide

## Overview

This document describes the end-to-end testing approach for the autoresearch Pi extension.

## E2E Test Scripts

### 1. Automated E2E Test (`scripts/e2e-automated-test.sh`)

- **Purpose**: Tests the complete autoresearch workflow without requiring Pi
- **What it tests**:
  - Creates temporary test projects
  - Runs benchmark baseline measurements
  - Runs optimization experiments
  - Validates decision file generation
  - Cleans up test artifacts
- **Run**: `npm run test:e2e`

### 2. Interactive Tmux Test (`scripts/e2e-tmux-test.sh`)

- **Purpose**: Provides a tmux-based interactive testing environment
- **What it provides**:
  - Creates isolated tmux session for manual testing
  - Sets up test project structure
  - Allows manual command testing
- **Run**: `bash scripts/e2e-tmux-test.sh`

### 3. Pi-Based E2E Test (`scripts/autoresearch-e2e-test.sh`)

- **Purpose**: Tests the autoresearch extension running inside Pi
- **What it tests**:
  - Extension loading in Pi
  - Command availability
  - Tool registration
  - State management
  - Complete workflow validation
- **Run**: `npm run test:e2e:pi`

## Important: Tmux Session Management

### Critical Requirement

**E2E testing must use a unique tmux session name and must NOT kill existing user sessions.**

### Why This Matters

- Users may have active tmux sessions for their work
- Killing existing sessions is disruptive and destroys user state
- E2E tests should be isolated and non-destructive

### Implementation

The Pi-based E2E test script uses a unique session name with the process ID:

```bash
SESSION_NAME="autoresearch-e2e-$$"  # $$ is the current process ID
```

This ensures:

- Each test run gets a unique session name
- No conflict with existing user sessions
- Clean cleanup without affecting other sessions

### Best Practices for E2E Testing

1. **Always use unique session names**: Include process ID or timestamp
2. **Never kill all sessions**: Only kill sessions you created
3. **Check before killing**: Verify the session belongs to your test
4. **Clean up properly**: Always remove test sessions after completion

### Example: Safe Session Management

```bash
# Good: Unique session name with process ID
SESSION_NAME="my-test-$$"
tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true

# Bad: Hardcoded session name that might conflict
SESSION_NAME="test"  # Could conflict with user's session
tmux kill-session -t "test"  # Destructive!

# Bad: Killing all sessions
tmux kill-server  # NEVER do this in tests!
```

## Test Coverage

### Extension Loading

- Verifies extension loads without errors
- Checks extension registration in Pi
- Validates command availability

### Command Testing

- Tests `/autoresearch new` command
- Tests `/autoresearch status` command
- Tests `/autoresearch ralph` command
- Validates command responses

### Tool Registration

- Verifies tools are registered in Pi
- Tests tool invocation
- Validates tool responses

### State Management

- Tests state file creation
- Validates state persistence
- Tests state updates

### Workflow Validation

- Tests complete benchmark → optimization → decision flow
- Validates JSONL output format
- Tests decision file generation

## Running Tests

### Quick Test (Automated)

```bash
npm run test:e2e
```

### Full Test Suite (Including Pi)

```bash
npm run test:e2e:pi
```

### Manual Interactive Testing

```bash
bash scripts/e2e-tmux-test.sh
```

## Troubleshooting

### Session Already Exists

If you get "session already exists" errors:

1. Check for stuck test sessions: `tmux list-sessions`
2. Kill only test sessions: `tmux kill-session -t autoresearch-e2e-*`
3. Never kill sessions you don't recognize

### Pi Not Available

If Pi is not available, the test will skip Pi-dependent tests and continue with file system tests.

### Test Directory Cleanup

If test directories remain after cleanup:

```bash
rm -rf /tmp/autoresearch-e2e-test
```

## Adding New Tests

When adding new E2E tests:

1. Use unique session names with process ID
2. Clean up all created resources
3. Never affect user's existing sessions/state
4. Document what the test validates
5. Add test commands to package.json if appropriate

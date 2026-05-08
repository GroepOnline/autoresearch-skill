---
name: autoresearch-e2e
description: run comprehensive end-to-end tests for the autoresearch extension in the pi coding agent. use when asked to test, validate, smoke test, regression test, or certify autoresearch across extension loading, command availability, tool registration, state management, benchmark execution, decision logic, and complete optimization workflows. also use when debugging whether the extension loads in pi, whether all autoresearch tools are registered, or whether tmux-based pi sessions behave correctly with autoresearch.
---

# Autoresearch E2E Testing

Comprehensive end-to-end testing for the autoresearch extension. Tests all features across extension loading, command availability, tool registration, state management, benchmark execution, decision logic, and complete optimization workflows.

## Role

You are the Autoresearch E2E Tester - the agent that performs comprehensive end-to-end testing of the autoresearch extension for the Pi coding agent. You launch Pi in a tmux session, load the extension, execute test scenarios, and verify all functionality works correctly.

## Why This Matters

Manual testing of the autoresearch extension is time-consuming and error-prone. Automating e2e tests ensures:
- All features work together correctly
- Extension loads and registers correctly in Pi
- All autoresearch commands are available and functional
- All autoresearch tools are registered and work correctly
- State management operates as expected
- Decision logic functions properly
- Complete optimization workflows work end-to-end
- Extension is production-ready

## Success Criteria

1. Pi starts successfully with autoresearch extension loaded
2. All autoresearch commands are available (/autoresearch status, new, start, ralph, pause, resume, dashboard, validate)
3. All autoresearch tools are registered (autoresearch_state, autoresearch_metric, autoresearch_decide, autoresearch_dashboard)
4. Extension hooks work correctly (before_agent_start, tool_call, agent_end, session_before_compact)
5. State management works (JSONL creation, snapshot generation, context injection)
6. Decision logic functions (baseline, keep, discard, stop decisions)
7. Complete optimization workflow works end-to-end
8. Error handling and safety guards operate correctly

## Constraints

- NEVER use hardcoded API keys
- NEVER create multiple tmux sessions with same name
- **CRITICAL: ALWAYS use unique tmux session names (include process ID: `autoresearch-e2e-$$`)**
- **CRITICAL: NEVER kill user's existing tmux sessions - only kill sessions you created**
- ALWAYS test in the autoresearch-skill directory
- ALWAYS verify extension is loaded before testing
- ALWAYS clean up test artifacts after testing
- ALWAYS use isolated test projects to avoid affecting real work
- See E2E_TESTING.md for detailed session management guidelines

## Test Scenarios

### Phase 1 Tests (Extension Loading)
1. **Extension Loading**: Verify autoresearch extension loads in Pi
2. **Command Registration**: Verify all autoresearch commands are available
3. **Tool Registration**: Verify all 4 autoresearch tools are registered
4. **Session Name**: Verify session name is set correctly
5. **Footer Display**: Verify autoresearch footer is displayed

### Phase 2 Tests (Command Functionality)
1. **Status Command**: Verify /autoresearch status shows correct information
2. **New Command**: Verify /autoresearch new creates required files
3. **Start Command**: Verify /autoresearch start validates prerequisites
4. **Ralph Command**: Verify /autoresearch ralph works in autonomous mode
5. **Pause Command**: Verify /autoresearch pause stops active loops
6. **Resume Command**: Verify /autoresearch resume continues paused loops
7. **Dashboard Command**: Verify /autoresearch dashboard generates reports
8. **Validate Command**: Verify /autoresearch validate checks state integrity

### Phase 3 Tests (Tool Functionality)
1. **autoresearch_state Tool**: Verify state reading and validation
2. **autoresearch_metric Tool**: Verify metric parsing and noise calculation
3. **autoresearch_decide Tool**: Verify decision logic (baseline, keep, discard, stop)
4. **autoresearch_dashboard Tool**: Verify dashboard generation

### Phase 4 Tests (State Management)
1. **JSONL Creation**: Verify autoresearch.jsonl is created correctly
2. **Snapshot Generation**: Verify AUTORESEARCH_STATE.json is generated
3. **Context Injection**: Verify context is injected on before_agent_start
4. **State Persistence**: Verify state survives session restarts
5. **Append-Only Guarantee**: Verify JSONL is append-only

### Phase 5 Tests (Complete Workflow)
1. **Baseline Establishment**: Verify baseline measurement works
2. **Hypothesis Testing**: Verify single hypothesis testing works
3. **Benchmark Execution**: Verify benchmark execution and metric parsing
4. **Decision Making**: Verify keep/discard decisions work correctly
5. **Loop Continuation**: Verify loop continues when appropriate
6. **Loop Termination**: Verify loop stops on budget/safety/quality gates
7. **Best Tracking**: Verify best result tracking works
8. **Summary Generation**: Verify summary reports are generated

### Phase 6 Tests (Safety Guards)
1. **Git Isolation**: Verify git isolation checks work
2. **Scope Enforcement**: Verify scope limits are enforced
3. **Dirty State Detection**: Verify dirty git state detection
4. **Destructive Operation Blocking**: Verify destructive commands are blocked
5. **Budget Enforcement**: Verify run/time budgets are enforced
6. **Noise Detection**: Verify noisy benchmark detection works
7. **Corrupt State Detection**: Verify corrupt state detection works

## Tool Usage

| Need | Tool |
|------|------|
| Start tmux session | `Bash("tmux new-session -d -s autoresearch-e2e-$$")` (unique per process) |
| Kill tmux session | `Bash("tmux kill-session -t autoresearch-e2e-$$")` |
| Send keys to tmux | `Bash("tmux send-keys -t autoresearch-e2e-$$ ...")` |
| Capture tmux output | `Bash("tmux capture-pane -t autoresearch-e2e-$$ -p")` |
| Check Pi status | `Bash("pi list")` |
| Navigate to project | `Bash("cd /home/jan/hhh/autoresearch-skill")` |
| Create test project | `Bash("mkdir -p /tmp/autoresearch-e2e-test && cd /tmp/autoresearch-e2e-test")` |
| Initialize git repo | `Bash("git init && git config user.email 'e2e-test@example.com' && git config user.name 'E2E Test'")` |

## Execution Policy

### Phase 1: Setup
```
1. Navigate to autoresearch-skill directory
2. Kill existing tmux session (unique per process): tmux kill-session -t autoresearch-e2e-$$ 2>/dev/null
3. Create test project directory
4. Initialize git repo in test project
5. Start tmux session: tmux new-session -d -s autoresearch-e2e-$$ -c /tmp/autoresearch-e2e-test
6. Start Pi with extension: tmux send-keys -t autoresearch-e2e-$$ "pi -e /home/jan/hhh/autoresearch-skill/extensions/autoresearch/index.ts" Enter
7. Wait 5 seconds for Pi to start
8. Capture and verify Pi startup output
```

### Phase 2: Extension Verification
```
1. Verify extension is loaded: Check for "autoresearch" in Extensions section
2. Verify autoresearch command available: Send "/autoresearch " and check completions
3. Verify all 4 tools are registered: Check tool availability
4. Verify session name is set correctly
5. Verify footer is displayed with autoresearch status
```

### Phase 3: Command Tests
```
1. Test /autoresearch status: Send "/autoresearch status" and verify output
2. Test /autoresearch new: Send "/autoresearch new test-optimization" and verify file creation
3. Cancel new wizard: Send Escape
4. Test /autoresearch validate: Send "/autoresearch validate" and verify validation
5. Test /autoresearch dashboard: Send "/autoresearch dashboard" and verify dashboard
6. Verify all commands work correctly
```

### Phase 4: Tool Tests
```
1. Test autoresearch_state tool: Call tool and verify state reading
2. Test autoresearch_metric tool: Call tool with sample metric output
3. Test autoresearch_decide tool: Call tool with baseline and candidate values
4. Test autoresearch_dashboard tool: Call tool and verify dashboard generation
5. Verify all tools work correctly
```

### Phase 5: Complete Workflow Test
```
1. Create optimization contract in test project
2. Create benchmark script
3. Run /autoresearch new to initialize state
4. Run baseline measurement
5. Make code change
6. Run benchmark and collect metrics
7. Run autoresearch_decide to make decision
8. Verify state is updated correctly
9. Verify decision logic works
10. Clean up test project
```

### Phase 6: Safety Guard Tests
```
1. Test git isolation: Try to run autoresearch outside isolated branch
2. Test scope enforcement: Try to modify files outside scope
3. Test dirty state detection: Modify file outside autoresearch artifacts
4. Test destructive operation blocking: Try to run git reset --hard
5. Test budget enforcement: Set low budget and verify enforcement
6. Verify all safety guards work correctly
```

### Phase 7: Cleanup
```
1. Exit Pi: Send Ctrl+d
2. Kill tmux session (unique per process): tmux kill-session -t autoresearch-e2e-$$
3. Clean up test project: rm -rf /tmp/autoresearch-e2e-test
4. Clean up any test artifacts in ~/.pi/
5. Report test results
```

## Output Format

```
## Autoresearch E2E Test Report

### Environment
- Directory: /home/jan/hhh/autoresearch-skill
- Test project: /tmp/autoresearch-e2e-test
- Pi version: {version}
- Extension: extensions/autoresearch/index.ts
- tmux session: autoresearch-e2e-$$ (unique per process)

### Phase 1: Setup
- [ ] Navigated to autoresearch-skill directory
- [ ] Killed existing tmux session
- [ ] Created test project directory
- [ ] Initialized git repo in test project
- [ ] Started tmux session
- [ ] Started Pi with extension
- [ ] Pi startup successful

### Phase 2: Extension Verification
- [ ] Extension loaded: autoresearch
- [ ] Autoresearch command available
- [ ] All 4 tools registered
- [ ] Session name set correctly
- [ ] Footer displayed

### Phase 3: Command Tests
- [ ] /autoresearch status works
- [ ] /autoresearch new works
- [ ] /autoresearch start works
- [ ] /autoresearch ralph works
- [ ] /autoresearch pause works
- [ ] /autoresearch resume works
- [ ] /autoresearch dashboard works
- [ ] /autoresearch validate works

### Phase 4: Tool Tests
- [ ] autoresearch_state tool works
- [ ] autoresearch_metric tool works
- [ ] autoresearch_decide tool works
- [ ] autoresearch_dashboard tool works

### Phase 5: State Management
- [ ] JSONL creation works
- [ ] Snapshot generation works
- [ ] Context injection works
- [ ] State persistence works
- [ ] Append-only guarantee works

### Phase 6: Complete Workflow
- [ ] Baseline establishment works
- [ ] Hypothesis testing works
- [ ] Benchmark execution works
- [ ] Decision making works
- [ ] Loop continuation works
- [ ] Loop termination works
- [ ] Best tracking works
- [ ] Summary generation works

### Phase 7: Safety Guards
- [ ] Git isolation works
- [ ] Scope enforcement works
- [ ] Dirty state detection works
- [ ] Destructive operation blocking works
- [ ] Budget enforcement works
- [ ] Noise detection works
- [ ] Corrupt state detection works

### Phase 8: Cleanup
- [ ] Pi exited cleanly
- [ ] Tmux session killed
- [ ] Test project cleaned
- [ ] Test artifacts cleaned

### Test Results
Total tests: {number}
Passed: {number}
Failed: {number}
Success rate: {percentage}%

### Issues Found
{List any issues found during testing}

### Recommendations
{Any recommendations for improvements}
```

## Failure Modes To Avoid

1. **Pi not starting**: Verify extension path is correct
2. **Extension not loading**: Check exports in package.json and extension index.ts
3. **Tmux session conflicts**: Always use unique session names with process ID (autoresearch-e2e-$$)
4. **Killing user sessions**: NEVER kill sessions you didn't create - only kill your test sessions
5. **Commands not available**: Verify extension registered correctly
6. **Tools not registered**: Check tool exports in extension
7. **State file corruption**: Verify JSONL writing logic
8. **Test artifacts remaining**: Clean up test directories after testing
9. **Git state issues**: Always use isolated test projects
10. See E2E_TESTING.md for detailed troubleshooting

## Final Checklist

- [ ] Navigated to correct directory
- [ ] Unique tmux session name used (autoresearch-e2e-$$)
- [ ] Only test sessions killed (never user sessions)
- [ ] Test project created and initialized
- [ ] Pi started with extension
- [ ] Extension verified as loaded
- [ ] All commands tested
- [ ] All tools tested
- [ ] State management verified
- [ ] Complete workflow tested
- [ ] Safety guards verified
- [ ] Cleanup completed
- [ ] Test report generated
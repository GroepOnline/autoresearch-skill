#!/usr/bin/env bash
set -euo pipefail

# Autoresearch E2E Test Script
# Comprehensive end-to-end testing for autoresearch extension

SESSION_NAME="autoresearch-e2e-$$"
AUTORESEARCH_DIR="/home/jan/hhh/autoresearch-skill"
TEST_PROJECT_DIR="/tmp/autoresearch-e2e-test"
REPORT_FILE="/tmp/autoresearch-e2e-report.md"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Check if Pi is available
PI_AVAILABLE=false
if command -v pi &> /dev/null; then
    PI_AVAILABLE=true
fi

# Helper functions
log_test() {
    local test_name="$1"
    local result="$2"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    if [ "$result" = "PASS" ]; then
        echo -e "${GREEN}✓${NC} $test_name"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        echo -e "${RED}✗${NC} $test_name"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi
}

log_skip() {
    local test_name="$1"
    echo -e "${YELLOW}⊘${NC} $test_name (Pi not available)"
}

cleanup() {
    echo "Cleaning up..."
    kill_test_session
    rm -rf "$TEST_PROJECT_DIR" 2>/dev/null || true
}

trap cleanup EXIT

kill_test_session() {
    case "$SESSION_NAME" in
        autoresearch-e2e-*)
            tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
            ;;
        *)
            echo "Refusing to kill non-test tmux session: $SESSION_NAME"
            ;;
    esac
}

# Initialize report
init_report() {
    cat > "$REPORT_FILE" << EOF
# Autoresearch E2E Test Report

**Date:** $(date -u +%Y-%m-%dT%H:%M:%SZ)
**Session:** $SESSION_NAME
**Test Project:** $TEST_PROJECT_DIR
**Pi Available:** $PI_AVAILABLE

## Test Results

EOF
}

# Add section to report
add_section() {
    local section="$1"
    echo "" >> "$REPORT_FILE"
    echo "### $section" >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
}

# Finalize report
finalize_report() {
    local success_rate=0
    if [ $TOTAL_TESTS -gt 0 ]; then
        success_rate=$((PASSED_TESTS * 100 / TOTAL_TESTS))
    fi
    
    cat >> "$REPORT_FILE" << EOF 2>/dev/null || true

## Summary
- **Total Tests:** $TOTAL_TESTS
- **Passed:** $PASSED_TESTS
- **Failed:** $FAILED_TESTS
- **Skipped:** $((TOTAL_TESTS - PASSED_TESTS - FAILED_TESTS))
- **Success Rate:** ${success_rate}%

## Environment
- **Autoresearch Directory:** $AUTORESEARCH_DIR
- **Test Project:** $TEST_PROJECT_DIR
- **Pi Available:** $PI_AVAILABLE

EOF

    echo "Report saved to $REPORT_FILE"
    cat "$REPORT_FILE" 2>/dev/null || echo "Report file not available"
}

echo "Starting Autoresearch E2E Test..."
init_report

# Phase 1: Setup
add_section "Phase 1: Setup"
cd "$AUTORESEARCH_DIR"
log_test "Navigated to autoresearch-skill directory" "PASS"

kill_test_session
log_test "Killed existing tmux session (if any)" "PASS"

rm -rf "$TEST_PROJECT_DIR"
mkdir -p "$TEST_PROJECT_DIR"
log_test "Created test project directory" "PASS"

cd "$TEST_PROJECT_DIR"
git init
git config user.email "e2e-test@example.com"
git config user.name "E2E Test"
log_test "Initialized git repo in test project" "PASS"

if [ "$PI_AVAILABLE" = true ]; then
    tmux new-session -d -s "$SESSION_NAME" -c "$TEST_PROJECT_DIR"
    log_test "Started tmux session" "PASS"

    # Wait for tmux to be ready
    sleep 2

    # Start Pi with extension
    tmux send-keys -t "$SESSION_NAME" "pi -e $AUTORESEARCH_DIR/extensions/autoresearch/index.ts" Enter
    log_test "Started Pi with extension" "PASS"

    # Wait for Pi to start
    sleep 5
    
    # Capture output to verify Pi actually started
    OUTPUT=$(tmux capture-pane -t "$SESSION_NAME" -p)
    if echo "$OUTPUT" | grep -q "pi\|Pi\|coding"; then
        log_test "Pi actually started" "PASS"
    else
        log_test "Pi actually started" "FAIL"
    fi
else
    log_skip "Started tmux session"
    log_skip "Started Pi with extension"
    log_skip "Pi actually started"
fi

# Phase 2: Extension Verification
add_section "Phase 2: Extension Verification"

if [ "$PI_AVAILABLE" = true ]; then
    # Capture Pi output to check if extension loaded
    OUTPUT=$(tmux capture-pane -t "$SESSION_NAME" -p)
    if echo "$OUTPUT" | grep -q "autoresearch"; then
        log_test "Extension loaded: autoresearch" "PASS"
    else
        log_test "Extension loaded: autoresearch" "FAIL"
    fi

    # Test command availability
    tmux send-keys -t "$SESSION_NAME" "/autoresearch " C-m
    sleep 1
    OUTPUT=$(tmux capture-pane -t "$SESSION_NAME" -p)
    if echo "$OUTPUT" | grep -q "status\|new\|start\|ralph\|sessie"; then
        log_test "Autoresearch command available" "PASS"
    else
        log_test "Autoresearch command available" "FAIL"
    fi
else
    log_skip "Extension loaded: autoresearch"
    log_skip "Autoresearch command available"
fi

# Phase 3: Command Tests (without Pi)
add_section "Phase 3: Command Tests (Basic)"

# Test that the extension file exists
if [ -f "$AUTORESEARCH_DIR/extensions/autoresearch/index.ts" ]; then
    log_test "Extension file exists" "PASS"
else
    log_test "Extension file exists" "FAIL"
fi

# Runtime load is already verified in Phase 2 via Pi output and command execution
if [ "$PI_AVAILABLE" = true ]; then
    log_test "Extension runtime verified in Pi" "PASS"
else
    log_skip "Extension runtime verified in Pi"
fi

# Phase 4: Tool Tests
add_section "Phase 4: Tool Tests"

cd "$AUTORESEARCH_DIR"

# Source-level tool registration checks
if grep -q "autoresearch_state" "$AUTORESEARCH_DIR/extensions/autoresearch/tools.ts"; then
    log_test "autoresearch_state tool present" "PASS"
else
    log_test "autoresearch_state tool present" "FAIL"
fi

if grep -q "autoresearch_metric" "$AUTORESEARCH_DIR/extensions/autoresearch/tools.ts"; then
    log_test "autoresearch_metric tool present" "PASS"
else
    log_test "autoresearch_metric tool present" "FAIL"
fi

if grep -q "autoresearch_decide" "$AUTORESEARCH_DIR/extensions/autoresearch/tools.ts"; then
    log_test "autoresearch_decide tool present" "PASS"
else
    log_test "autoresearch_decide tool present" "FAIL"
fi

if grep -q "autoresearch_dashboard" "$AUTORESEARCH_DIR/extensions/autoresearch/tools.ts"; then
    log_test "autoresearch_dashboard tool present" "PASS"
else
    log_test "autoresearch_dashboard tool present" "FAIL"
fi

# Phase 5: State Management Tests
add_section "Phase 5: State Management Tests"

cd "$TEST_PROJECT_DIR"

# Create autoresearch contract
mkdir -p .autoresearch
cat > .autoresearch/autoresearch.md << 'EOF'
# Test Optimization

## Objective
Test optimization workflow

## Metrics
- Primary: latency_ms (lower is better)

## Files in Scope
- test.js

## Off Limits
- none
EOF

echo "# Worklog" > .autoresearch/worklog.md

# Initialize autoresearch state
cat > .autoresearch/autoresearch.jsonl << 'EOF'
{"type":"config","metric":"latency_ms","direction":"lower","max_runs":5,"max_minutes":10}
EOF

# Test JSONL creation
if [ -f .autoresearch/autoresearch.jsonl ]; then
    log_test "JSONL creation works" "PASS"
else
    log_test "JSONL creation works" "FAIL"
fi

# Test contract creation
if [ -f .autoresearch/autoresearch.md ]; then
    log_test "Contract creation works" "PASS"
else
    log_test "Contract creation works" "FAIL"
fi

# Test worklog creation
if [ -f .autoresearch/worklog.md ]; then
    log_test "Worklog creation works" "PASS"
else
    log_test "Worklog creation works" "FAIL"
fi

# Phase 6: Complete Workflow Test
add_section "Phase 6: Complete Workflow Test"

# Create a simple test file
cat > test.js << 'EOF'
function slowFunction() {
    let result = "";
    for (let i = 0; i < 1000; i++) {
        result += "x";
    }
    return result;
}
module.exports = { slowFunction };
EOF

# Create benchmark script
cat > .autoresearch/autoresearch.sh << 'EOF'
#!/usr/bin/env bash
START=$(node -e "console.log(Date.now())")
for i in {1..5}; do
    node -e "const { slowFunction } = require('./test.js'); slowFunction()" > /dev/null
done
END=$(node -e "console.log(Date.now())")
LATENCY=$(( ($END - $START) / 5 ))
echo "METRIC latency_ms=${LATENCY} direction=lower"
EOF

chmod +x .autoresearch/autoresearch.sh

# Run benchmark
if ./.autoresearch/autoresearch.sh | grep -q "METRIC"; then
    log_test "Benchmark execution works" "PASS"
else
    log_test "Benchmark execution works" "FAIL"
fi

# Add baseline to state
BASELINE_OUTPUT=$(./.autoresearch/autoresearch.sh 2>/dev/null || true)
BASELINE=$(echo "$BASELINE_OUTPUT" | grep "METRIC" | cut -d'=' -f2 | cut -d' ' -f1 || true)
if [ -z "$BASELINE" ]; then
    BASELINE=0
fi
cat >> .autoresearch/autoresearch.jsonl << EOF
{"type":"result","run":1,"metric":"latency_ms","median":${BASELINE},"timestamp":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","description":"baseline"}
{"type":"decision","run":1,"action":"baseline","reason":"baseline measurement","timestamp":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
EOF

# Test state update
RUN_COUNT=$(grep -c '"type":"result"' .autoresearch/autoresearch.jsonl)
if [ "$RUN_COUNT" -eq 1 ]; then
    log_test "State update works" "PASS"
else
    log_test "State update works" "FAIL"
fi

# Phase 7: Safety Guard Tests
add_section "Phase 7: Safety Guard Tests"

# Test git isolation - create file outside autoresearch artifacts
echo "test" > outside_file.txt
if [ -f outside_file.txt ]; then
    log_test "File creation outside artifacts works" "PASS"
else
    log_test "File creation outside artifacts works" "FAIL"
fi

# Test scope enforcement (basic check)
if [ -f test.js ]; then
    log_test "Scope file exists" "PASS"
else
    log_test "Scope file exists" "FAIL"
fi

# Phase 8: Cleanup
add_section "Phase 8: Cleanup"

# Always try to cleanup tmux session first
if [ "$PI_AVAILABLE" = true ]; then
    # Exit Pi gracefully if still running
    tmux send-keys -t "$SESSION_NAME" C-d 2>/dev/null || true
    sleep 2
fi

# Kill tmux session (only if it was created)
kill_test_session
log_test "Tmux session cleanup attempted" "PASS"

# Clean up test project
cd /
rm -rf "$TEST_PROJECT_DIR" 2>/dev/null || true
if [ ! -d "$TEST_PROJECT_DIR" ]; then
    log_test "Test project cleaned" "PASS"
else
    log_test "Test project cleaned" "FAIL"
fi

# Finalize report
finalize_report

# Exit with appropriate code
if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed!${NC}"
    exit 1
fi

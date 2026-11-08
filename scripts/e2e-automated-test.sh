#!/usr/bin/env bash
set -euo pipefail

# Automated E2E test for autoresearch skill
# This script creates a test project and runs a complete autoresearch workflow

TEMP_DIR=$(mktemp -d)
PROJECT_DIR="$TEMP_DIR/test-project"

echo "Setting up automated e2e test..."
echo "Temp dir: $TEMP_DIR"

# Cleanup function
cleanup() {
    echo "Cleaning up..."
    rm -rf "$TEMP_DIR"
}

trap cleanup EXIT

# Create test project
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"

# Initialize git repo
git init
git config user.email "e2e-test@example.com"
git config user.name "E2E Test"

# Create a simple JavaScript file to optimize (inefficient version)
mkdir -p src
cat > src/parser.js << 'EOF'
function parse(input) {
    let result = "";
    // Inefficient string concatenation in loop
    for (let i = 0; i < input.length; i++) {
        result += input[i];
        // Artificial slowdown with useless operations
        for (let j = 0; j < 50; j++) {
            Math.random();
        }
    }
    return JSON.parse(result);
}
module.exports = { parse };
EOF

# Create benchmark script
mkdir -p .autoresearch
cat > .autoresearch/autoresearch.sh << 'EOF'
#!/usr/bin/env bash
set -euo pipefail

# Warmup
for i in {1..3}; do
    node -e "const input = JSON.stringify({test: 'data'.repeat(100)}); require('./src/parser.js').parse(input);" > /dev/null
done

# Actual benchmark
START=$(node -e "console.log(Date.now())")
for i in {1..20}; do
    node -e "const input = JSON.stringify({test: 'data'.repeat(100)}); require('./src/parser.js').parse(input);" > /dev/null
done
END=$(node -e "console.log(Date.now())")

LATENCY=$(( ($END - $START) / 20 ))
echo "METRIC latency_ms=${LATENCY} direction=lower"
EOF

chmod +x .autoresearch/autoresearch.sh

# Create initial commit
git add src/parser.js .autoresearch/autoresearch.sh
git commit -m "Initial commit"

# Create autoresearch contract
cat > .autoresearch/autoresearch.md << 'EOF'
# Autoresearch: Optimize Parser

## Objective
Reduce parser latency without changing behavior.

## Metrics
- **Primary**: latency_ms (ms, lower is better)

## How to Run
`./.autoresearch/autoresearch.sh` prints METRIC latency_ms values.

## Files in Scope
- src/parser.ts

## Off Limits
- none
EOF

echo "# Worklog" > .autoresearch/worklog.md

# Create initial state files
cat > .autoresearch/autoresearch.jsonl << 'EOF'
{"type":"config","metric":"latency_ms","direction":"lower","max_runs":10,"max_minutes":30,"effect_size":0.05,"noise_floor":0.02}
EOF

echo "Running baseline benchmark..."
BASELINE=$(./.autoresearch/autoresearch.sh | grep "METRIC" | cut -d'=' -f2 | cut -d' ' -f1)
echo "Baseline latency: ${BASELINE}ms"

# Add baseline to state
cat >> .autoresearch/autoresearch.jsonl << EOF
{"type":"result","run":1,"metric":"latency_ms","median":${BASELINE},"timestamp":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","description":"baseline"}
{"type":"decision","run":1,"action":"baseline","reason":"baseline measurement","timestamp":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
EOF

echo "Creating optimized version..."
cat > src/parser.js << 'EOF'
function parse(input) {
    return JSON.parse(input);
}
module.exports = { parse };
EOF

git add src/parser.js
git commit -m "Optimize parser"

echo "Running optimized benchmark..."
OPTIMIZED=$(./.autoresearch/autoresearch.sh | grep "METRIC" | cut -d'=' -f2 | cut -d' ' -f1)
echo "Optimized latency: ${OPTIMIZED}ms"

# Add result to state
cat >> .autoresearch/autoresearch.jsonl << EOF
{"type":"result","run":2,"metric":"latency_ms","median":${OPTIMIZED},"timestamp":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","description":"remove string concatenation"}
EOF

# Make decision
THRESHOLD=$(echo "$BASELINE * 0.95" | awk '{printf "%d", $1}')
if [ "$OPTIMIZED" -lt "$THRESHOLD" ]; then
    ACTION="keep"
    REASON="improved above threshold"
else
    ACTION="discard"
    REASON="no significant improvement"
fi

cat >> .autoresearch/autoresearch.jsonl << EOF
{"type":"decision","run":2,"action":"$ACTION","reason":"$REASON","timestamp":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
EOF

echo "Decision: $ACTION - $REASON"

# Verify state
echo "Verifying state..."
RUN_COUNT=$(grep -c '"type":"result"' .autoresearch/autoresearch.jsonl)
DECISION_COUNT=$(grep -c '"type":"decision"' .autoresearch/autoresearch.jsonl)
echo "Total runs: $RUN_COUNT"
echo "Total decisions: $DECISION_COUNT"

# Verify the workflow completed successfully
if [ "$RUN_COUNT" -eq 2 ] && [ "$DECISION_COUNT" -eq 2 ]; then
    echo "✓ E2E test PASSED: Workflow completed successfully"
    echo "  Decision: $ACTION - $REASON"
    echo "  Baseline: ${BASELINE}ms"
    echo "  Optimized: ${OPTIMIZED}ms"
    exit 0
else
    echo "✗ E2E test FAILED: Workflow did not complete correctly"
    exit 1
fi

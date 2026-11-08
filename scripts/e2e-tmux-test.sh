#!/usr/bin/env bash
set -euo pipefail

# E2E test script using tmux for autoresearch skill
# This script creates a tmux session and runs a complete autoresearch workflow

SESSION_NAME="autoresearch-e2e-$$"
TEMP_DIR=$(mktemp -d)
PROJECT_DIR="$TEMP_DIR/test-project"

echo "Setting up e2e test environment..."
echo "Session: $SESSION_NAME"
echo "Temp dir: $TEMP_DIR"

# Cleanup function
cleanup() {
    echo "Cleaning up..."
    tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
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

# Create a simple TypeScript file to optimize
mkdir -p src
cat > src/parser.ts << 'EOF'
export function parse(input: string): any {
    let result = "";
    for (let i = 0; i < input.length; i++) {
        result += input[i];
    }
    return JSON.parse(result);
}
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
for i in {1..10}; do
    node -e "const input = JSON.stringify({test: 'data'.repeat(100)}); require('./src/parser.js').parse(input);" > /dev/null
done
END=$(node -e "console.log(Date.now())")

LATENCY=$(( ($END - $START) / 10 ))
echo "METRIC latency_ms=${LATENCY} direction=lower"
EOF

chmod +x .autoresearch/autoresearch.sh

# Create initial commit
git add .
git commit -m "Initial commit"

# Create tmux session
echo "Creating tmux session..."
tmux new-session -d -s "$SESSION_NAME" -n "autoresearch"

# Send commands to tmux
tmux send-keys -t "$SESSION_NAME" "cd $PROJECT_DIR" C-m
tmux send-keys -t "$SESSION_NAME" "mkdir -p .autoresearch && cat > .autoresearch/autoresearch.md << 'EOF'
# Autoresearch: Optimize Parser

## Objective
Reduce parser latency without changing behavior.

## Metrics
- **Primary**: latency_ms (ms, lower is better)

## How to Run
\`./.autoresearch/autoresearch.sh\` prints METRIC latency_ms values.

## Files in Scope
- src/parser.ts

## Off Limits
- none
EOF
" C-m

tmux send-keys -t "$SESSION_NAME" "echo '# Worklog' > .autoresearch/worklog.md" C-m

echo "Tmux session created: $SESSION_NAME"
echo "Attach with: tmux attach-session -t $SESSION_NAME"
echo "Press Ctrl+C to exit and cleanup"

# Wait for user to inspect
read -p "Press Enter to continue with automated test or Ctrl+C to exit..."

# Run the benchmark
echo "Running baseline benchmark..."
cd "$PROJECT_DIR"
./.autoresearch/autoresearch.sh

echo "E2E test setup complete!"
echo "Project directory: $PROJECT_DIR"
echo "You can now manually test the autoresearch skill or press Enter to cleanup"
read -p "Press Enter to cleanup..."

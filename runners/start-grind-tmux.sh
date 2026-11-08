#!/bin/bash
# Start persistent grind in detached tmux session
# Usage: ./start-grind-tmux.sh [hours] [runs_per_batch]

HOURS="${1:-12}"
RUNS="${2:-20}"
SESSION="autoresearch-grind"

# Kill existing session if any
tmux kill-session -t "$SESSION" 2>/dev/null || true

# Start new detached session
tmux new-session -d -s "$SESSION" "cd /home/jan/OrgChefgroep/autoresearch-skill && ./runners/persistent-grind.sh $HOURS $RUNS"

echo "Started persistent grind in tmux session: $SESSION"
echo "  Duration: ${HOURS}h"
echo "  Runs per batch: $RUNS"
echo ""
echo "Monitor with: tmux attach -t $SESSION"
echo "Check status: tmux capture-pane -t $SESSION -p | tail -20"
echo "Stop with: tmux kill-session -t $SESSION"

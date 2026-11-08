#!/bin/bash
# Check persistent grind status

SESSION="autoresearch-grind"

if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "Grind is RUNNING in tmux session: $SESSION"
    echo ""
    echo "Latest output:"
    tmux capture-pane -t "$SESSION" -p | tail -15
    echo ""
    echo "Attach with: tmux attach -t $SESSION"
else
    echo "Grind is NOT running"
    echo ""
    echo "Last batch logs:"
    ls -lt /tmp/autoresearch-persistent/batch-*.log 2>/dev/null | head -3
fi

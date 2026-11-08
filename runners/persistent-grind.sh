#!/bin/bash
# Persistent autoresearch grind harness
# Runs in tmux, auto-restarts, commits after each batch
# Usage: ./persistent-grind.sh [--hours 12] [--runs 20]

set -euo pipefail

HOURS="${1:-12}"
MAX_RUNS="${2:-20}"
END_TIME=$(($(date +%s) + HOURS * 3600))
LOG_DIR="/tmp/autoresearch-persistent"
mkdir -p "$LOG_DIR"

RUNNER="/home/jan/OrgChefgroep/autoresearch-skill/runners/llamarunner.mjs"
SKILL_DIR="/home/jan/OrgChefgroep/skill-grinder"
COMMIT_MSG="autoresearch: persistent grind batch"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║   Persistent Autoresearch Harness                      ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Duration:   ${HOURS}h                                    ║"
echo "║  Max Runs:   ${MAX_RUNS} per batch                            ║"
echo "║  End Time:   $(date -d @$END_TIME '+%Y-%m-%d %H:%M')              ║"
echo "╚══════════════════════════════════════════════════════════╝"

BATCH=0
TOTAL_KEPT=0
TOTAL_DISCARDED=0

while [ $(date +%s) -lt $END_TIME ]; do
    BATCH=$((BATCH + 1))
    BATCH_LOG="$LOG_DIR/batch-${BATCH}-$(date +%Y%m%d-%H%M%S).log"

    echo ""
    echo "═══ Batch $BATCH ($(date '+%H:%M:%S')) ═══"

    # Run the grind
    cd /home/jan/OrgChefgroep/autoresearch-skill
    node runners/llamarunner.mjs --provider llama --max-runs $MAX_RUNS --max-minutes 30 2>&1 | tee "$BATCH_LOG"

    # Parse results
    KEPT=$(grep -c "KEPT" "$BATCH_LOG" || echo "0")
    DISCARDED=$(grep -c "DISCARDED" "$BATCH_LOG" || echo "0")
    TOTAL_KEPT=$((TOTAL_KEPT + KEPT))
    TOTAL_DISCARDED=$((TOTAL_DISCARDED + DISCARDED))

    echo "Batch $BATCH: $KEPT kept, $DISCARDED discarded"
    echo "Total: $TOTAL_KEPT kept, $TOTAL_DISCARDED discarded"

    # Commit if there are changes
    cd "$SKILL_DIR"
    if [ -n "$(git status --porcelain)" ]; then
        git add -A
        git commit -m "$COMMIT_MSG (batch $BATCH, $KEPT kept)" || true
        echo "Committed batch $BATCH"
    else
        echo "No changes to commit"
    fi

    # Check if we should continue
    if [ $(date +%s) -ge $END_TIME ]; then
        echo "Time limit reached"
        break
    fi

    # Brief pause between batches
    sleep 5
done

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   Persistent Grind Complete                            ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Batches:    $BATCH                                        ║"
echo "║  Total Kept: $TOTAL_KEPT                                       ║"
echo "║  Total Disc: $TOTAL_DISCARDED                                      ║"
echo "╚══════════════════════════════════════════════════════════╝"

# Final commit
cd "$SKILL_DIR"
if [ -n "$(git status --porcelain)" ]; then
    git add -A
    git commit -m "autoresearch: final persistent grind commit"
fi

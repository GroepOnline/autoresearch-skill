#!/usr/bin/env bash
set -euo pipefail

echo "Bootstrapping local environment for OnlineChefGroep/autoresearch-skill"

mkdir -p .artifacts .artifacts/screenshots .artifacts/computer-use .state

if [ ! -f .env.example ]; then
  echo "Missing .env.example" >&2
  exit 1
fi

if [ -f .env.local ]; then
  echo "Found .env.local (kept untracked; do not commit secrets)."
else
  echo "No .env.local found. Create one with: cp .env.example .env.local"
fi

if grep -Eq "(sk-[A-Za-z0-9]|ghp_[A-Za-z0-9]|AKIA[0-9A-Z]{16})" .env.example; then
  echo "Potential real secret found in .env.example; replace with blank placeholders." >&2
  exit 1
fi

if [ -f package-lock.json ]; then echo "Detected package-lock.json; run npm ci when you need dependencies."; elif [ -f package.json ]; then echo "Detected package.json without lockfile; inspect package manager before installing."; fi
echo "Safety defaults: DRY_RUN=true, computer-use disabled unless explicitly enabled, destructive actions require human approval."
echo "Bootstrap complete."

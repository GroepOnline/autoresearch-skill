#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  dirty="$(git status --porcelain)"
  if [ -n "$dirty" ]; then
    echo "Refusing to package from a dirty git tree:" >&2
    echo "$dirty" >&2
    exit 1
  fi
fi

out_dir="${1:-dist}"
mkdir -p "$out_dir"
rm -f "$out_dir/skill.zip"

zip -r "$out_dir/skill.zip" . \
  -x 'node_modules/*' \
  -x '*/node_modules/*' \
  -x '__pycache__/*' \
  -x '*/__pycache__/*' \
  -x '*.pyc' \
  -x '.git/*' \
  -x 'dist/*' \
  -x '.pytest_cache/*' \
  -x 'coverage/*'

echo "$out_dir/skill.zip"

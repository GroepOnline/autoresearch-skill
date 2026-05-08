#!/usr/bin/env bash
set -euo pipefail
for file in tests-ts/*.test.ts; do
  echo "== $file =="
  ./node_modules/.bin/tsx --test "$file"
done

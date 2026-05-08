#!/usr/bin/env bash
set -euo pipefail

start_ms=$(node -e "process.stdout.write(String(Date.now()))")

if [ -f package.json ] && command -v npm >/dev/null 2>&1; then
  npm run validate
elif [ -f scripts/validate.sh ] && command -v bash >/dev/null 2>&1; then
  bash scripts/validate.sh
elif [ -d tests ] && command -v python3 >/dev/null 2>&1; then
  python3 -m unittest discover -s tests -p 'test_*.py'
elif [ -d tests ] && command -v python >/dev/null 2>&1; then
  python -m unittest discover -s tests -p 'test_*.py'
fi

end_ms=$(node -e "process.stdout.write(String(Date.now()))")
run_seconds=$(node -e "const s=Number(process.argv[1]); const e=Number(process.argv[2]); process.stdout.write(((e-s)/1000).toFixed(6));" "$start_ms" "$end_ms")

echo "METRIC run_seconds=${run_seconds} direction=lower"

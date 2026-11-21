#!/usr/bin/env bash
set -euo pipefail
msg_file="${1:-}"
if [ -z "$msg_file" ] || [ ! -f "$msg_file" ]; then
  echo "check-conventional-commit: usage: $0 <commit-msg-file>" >&2
  exit 2
fi
subject=$(head -n 1 "$msg_file" | sed -e "s/[[:space:]]*$//")
case "$subject" in
  "Merge "*|"Revert "*|"fixup! "*|"squash! "*|"amend! "*) exit 0 ;;
esac
types="build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test"
if ! printf "%s" "$subject" | grep -qE "^(${types})(\([a-z0-9._/-]+\))?!?: .+"; then
  cat >&2 <<EOF
conventional commit required: <type>(<scope>)!: <subject>
  types: ${types}
  got:   ${subject}
EOF
  exit 1
fi
if [ "${#subject}" -gt 100 ]; then
  echo "check-conventional-commit: warning: subject is ${#subject} chars (soft limit 100)" >&2
fi
exit 0

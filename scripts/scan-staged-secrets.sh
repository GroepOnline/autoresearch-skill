#!/usr/bin/env bash
set -euo pipefail
if git diff --cached --quiet 2>/dev/null; then exit 0; fi
if command -v gitleaks >/dev/null 2>&1; then
  exec gitleaks protect --staged --redact --no-banner
fi
pattern="-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|(AKIA|ASIA)[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}"
hits=$(git diff --cached --no-color -U0 2>/dev/null \
  | grep -E "^\+" | grep -vE "^\+\+\+" | grep -vE "gitleaks:allow|allowlist secret" \
  | grep -nEI -e "$pattern" || true)
if [ -n "$hits" ]; then
  echo "possible secret in staged changes (masked):" >&2
  printf "%s\n" "$hits" | sed -E "s|([A-Za-z0-9_+/=-]{4})[A-Za-z0-9_+/=-]{6,}|\1<redacted>|g" >&2
  echo "remove it, or add the literal marker: gitleaks:allow" >&2
  exit 1
fi
exit 0

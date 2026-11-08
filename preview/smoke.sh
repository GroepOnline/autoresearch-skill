#!/bin/sh
# Smoke-test the installed preview package: the exact entries pi loads must
# exist in the shipped artifact.
set -eu
PREFIX="${1:-./pkg}"
PKG="$PREFIX/node_modules/@groeponline/pi-autoresearch"
fail() { echo "preview FAIL: $1" >&2; exit 1; }
test -f "$PKG/extensions/autoresearch/index.ts" || fail "missing pi extension entry extensions/autoresearch/index.ts"
test -d "$PKG/skills" || fail "missing pi skills dir"
echo "preview OK: @groeponline/pi-autoresearch (extension + skills present)"

#!/usr/bin/env bash
# Validates the marketplace and every plugin, then runs every plugin's tests.
# usage: scripts/check.sh
set -uo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
fail=0

claude plugin validate "$root" >/dev/null 2>&1 && echo "ok   marketplace" || { echo "FAIL marketplace"; fail=1; }

for dir in "$root"/plugins/*/; do
  name=$(basename "$dir")
  if ! claude plugin validate "$dir" >/dev/null 2>&1; then
    echo "FAIL $name: validate"; claude plugin validate "$dir" 2>&1 | grep -A3 "✘" | head -8; fail=1; continue
  fi
  out=$(claude plugin test "$dir" 2>&1)
  pass=$(echo "$out" | grep -oE '^ +[0-9]+ pass' | grep -oE '[0-9]+')
  bad=$(echo "$out" | grep -oE '^ +[0-9]+ fail' | grep -oE '[0-9]+')
  if [ "${bad:-1}" = "0" ]; then
    printf "ok   %-15s %s tests\n" "$name" "$pass"
  else
    echo "FAIL $name: tests"; echo "$out" | grep -E '^\(fail\)|Expected|Received' | head -10; fail=1
  fi
done

exit $fail

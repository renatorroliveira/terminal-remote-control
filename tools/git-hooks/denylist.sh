#!/bin/sh
# Prints the terms in this clone's local deny list, `.git/info/denylist`, in lower case: one term per line; blank
# lines and lines starting with # are skipped. The file lives inside .git, so it is never committed, and a clone
# without it prints nothing. Callers lower-case the text too and match with `grep -F`: Git for Windows' grep 3.0
# aborts on -i.
list="$(git rev-parse --git-common-dir)/info/denylist"
[ -f "$list" ] || exit 0
tr -d '\r' <"$list" | grep -v -e '^[[:space:]]*$' -e '^#' | LC_ALL=C tr 'A-Z' 'a-z'
exit 0

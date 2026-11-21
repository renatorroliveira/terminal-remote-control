#!/bin/sh
# Rejects a commit message that holds a term from the local deny list (denylist.sh); git drops the # lines. A grep
# failure refuses too, so the guard never passes a message it could not check.
terms=$(sh "$(dirname "$0")/denylist.sh")
[ -n "$terms" ] || exit 0
grep -v '^#' "$1" | LC_ALL=C tr 'A-Z' 'a-z' | grep -F -e "$terms" >/dev/null
if [ $? -ne 1 ]; then
    echo "refusing a commit message with a term from .git/info/denylist" >&2
    exit 1
fi

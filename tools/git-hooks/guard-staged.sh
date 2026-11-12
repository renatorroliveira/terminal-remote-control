#!/bin/sh
# Rejects staged agent folders, macOS home-directory paths and the committer's own home path, so machine-specific
# files and paths never reach git. Test-host paths such as /home/tester stay allowed.
status=0
home_pattern=$(printf '%s' "${HOME:-/nonexistent}" | sed 's/[][\.*^$/]/\\&/g')
for file in "$@"; do
    case $file in
        .claude/* | */.claude/* | .claude)
            echo "refusing to commit agent configuration: $file" >&2
            status=1
            continue
            ;;
    esac
    [ -f "$file" ] || continue
    if git show ":$file" 2>/dev/null | grep -I -n -E "/Users/[A-Za-z0-9._-]+/|$home_pattern/" >/dev/null; then
        echo "refusing to commit a home-directory path in: $file" >&2
        status=1
    fi
done
exit $status

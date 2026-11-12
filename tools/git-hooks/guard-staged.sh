#!/bin/sh
# Rejects staged agent folders and machine-specific absolute home paths, so they never reach git.
status=0
for file in "$@"; do
    case $file in
        .claude/* | */.claude/* | .claude)
            echo "refusing to commit agent configuration: $file" >&2
            status=1
            continue
            ;;
    esac
    [ -f "$file" ] || continue
    if git show ":$file" 2>/dev/null | grep -I -n -E '/(Users|home)/[A-Za-z0-9._-]+/' >/dev/null; then
        echo "refusing to commit an absolute home-directory path in: $file" >&2
        status=1
    fi
done
exit $status

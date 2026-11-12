#!/bin/sh
# Installs the lefthook hooks into this repository's own .git/hooks directory. A global core.hooksPath (for example
# a company-wide hook manager) is left untouched; such managers usually run the repository's hooks after their own.
set -eu
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0="$(cd "$(git rev-parse --git-common-dir)" && pwd)/hooks" \
    exec node_modules/.bin/lefthook install --force

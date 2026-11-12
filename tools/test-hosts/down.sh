#!/bin/sh
# Stops and removes the Linux test hosts and their generated keys.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
export DOCKER_CONTEXT="${DOCKER_CONTEXT:-colima-trc}"
docker compose -f "$here/compose.yaml" down --remove-orphans --volumes >/dev/null 2>&1 || true
rm -rf "$here/.run"

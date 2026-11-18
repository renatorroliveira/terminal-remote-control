#!/bin/sh
# Stops and deletes the macOS test VM and its network, and takes its hosts out of the test SSH config (P-57);
# --purge also deletes the base image, as at the end of E4.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
run="$here/.run"
hosts="$here/../.run"
image=ghcr.io/cirruslabs/macos-tahoe-vanilla@sha256:eeec54bfe1f076e27786c5d92b89187a05b1d109b5071eb2dcdf02d596e34640

tart stop trc-mac >/dev/null 2>&1 || true
until ! tart list 2>/dev/null | grep -q '^local *trc-mac .*running'; do
    sleep 1
done
tart delete trc-mac >/dev/null 2>&1 || true
if [ -f "$run/usernet.pid" ]; then
    kill "$(cat "$run/usernet.pid")" 2>/dev/null || true
fi
rm -rf "$run"
rm -f "$hosts/macos.ssh_config"
for file in known_hosts known_hosts.smoke; do
    [ -f "$hosts/$file" ] && sed -i '' '/^trc-mac /d' "$hosts/$file"
done
if [ "${1:-}" = --purge ]; then
    tart delete "$image" >/dev/null 2>&1 || true
    tart delete ghcr.io/cirruslabs/macos-tahoe-vanilla:latest >/dev/null 2>&1 || true
fi
exit 0

#!/bin/sh
# Fetches the daemons a released app bundled, for the upgrade tests (US-2.5.3): downloads the release's macOS arm64
# zip and SHA256SUMS.txt with gh, checks the zip, and extracts the bundled daemons and their manifest into the build
# cache, outside git. Usage: fetch-old-daemon.sh [version], 0.2.0 by default.
set -eu

version="${1:-0.2.0}"
cache="${TRC_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/trc}/daemon/$version"
if [ -f "$cache/manifest.json" ]; then
    echo "daemon $version already in $cache"
    exit 0
fi
download=$(mktemp -d)
trap 'rm -rf "$download"' EXIT
asset="TRC-$version-mac-arm64.zip"
gh release download "v$version" --repo renatorroliveira/terminal-remote-control --dir "$download" \
    --pattern "$asset" --pattern SHA256SUMS.txt
(cd "$download" && grep " $asset\$" SHA256SUMS.txt | shasum -a 256 -c - >/dev/null)
resources="Terminal Remote Control.app/Contents/Resources/daemon"
mkdir -p "$cache/linux-arm64" "$cache/linux-x64"
for file in manifest.json linux-arm64/trcd linux-x64/trcd; do
    unzip -p "$download/$asset" "$resources/$file" > "$cache/$file"
done
chmod 0755 "$cache/linux-arm64/trcd" "$cache/linux-x64/trcd"
echo "daemon $version extracted into $cache"

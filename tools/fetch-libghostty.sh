#!/bin/sh
# Downloads the libghostty-vt source and dependency tarballs named in tools/libghostty.manifest, verifies their
# minisign signatures and SHA-256 hashes, and extracts them into the build cache. The crate's build script never
# downloads anything; it only reads what this script verified (TECH_STACK D-14).
set -eu

here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=/dev/null
. "$here/libghostty.manifest"

cache="${TRC_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/trc}/libghostty-vt/$version"
stamp="$cache/verified"
expected="$source_sha256 $deps_sha256"

if [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$expected" ]; then
    echo "libghostty-vt $version already verified in $cache"
    exit 0
fi

command -v minisign >/dev/null 2>&1 || { echo "minisign is required (brew install minisign)" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }

download="$cache/download"
rm -rf "$cache"
mkdir -p "$download"

sha256() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

fetch() {
    name=$1 sum=$2
    curl -fsSL --proto '=https' --tlsv1.2 -o "$download/$name" "$base_url/$version/$name"
    curl -fsSL --proto '=https' --tlsv1.2 -o "$download/$name.minisig" "$base_url/$version/$name.minisig"
    minisign -Vq -P "$minisign_key" -m "$download/$name"
    [ "$(sha256 "$download/$name")" = "$sum" ] || { echo "SHA-256 mismatch for $name" >&2; exit 1; }
}

fetch "libghostty-vt-$version.tar.gz" "$source_sha256"
fetch "libghostty-vt-$version-deps.tar.gz" "$deps_sha256"

mkdir -p "$cache/src"
tar -xzf "$download/libghostty-vt-$version.tar.gz" -C "$cache/src"
tar -xzf "$download/libghostty-vt-$version-deps.tar.gz" -C "$cache/src"
printf '%s' "$expected" > "$stamp"
echo "libghostty-vt $version verified and extracted into $cache"

#!/bin/sh
# Builds the daemon's tests for Linux musl and runs every test binary in Ubuntu,
# Alpine and Rocky containers on the colima profile `trc`, as root, so the
# Linux-only and other-user checks run too. Extra arguments go to each binary.
set -eu

root=$(cd "$(dirname "$0")/../.." && pwd)
export DOCKER_CONTEXT="${DOCKER_CONTEXT:-colima-trc}"
images="ubuntu:24.04 alpine:3.23 rockylinux/rockylinux:9"

case "$(uname -m)" in
arm64 | aarch64) target=aarch64-unknown-linux-musl ;;
x86_64) target=x86_64-unknown-linux-musl ;;
*) echo "rust-tests: unsupported architecture $(uname -m)" >&2 && exit 1 ;;
esac

cd "$root"
binaries=$(cargo zigbuild --quiet --release --target "$target" -p trcd --tests --message-format=json |
    node -e '
        let input = "";
        process.stdin.on("data", (chunk) => (input += chunk));
        process.stdin.on("end", () => {
            for (const line of input.split("\n")) {
                const message = line.startsWith("{") ? JSON.parse(line) : {};
                if (message.reason === "compiler-artifact" && message.executable && message.profile.test) {
                    console.log(message.executable);
                }
            }
        });')

# The shells TRC integrates (US-5.1), added to each image once; docker keeps the layer for later runs.
shells_for() {
    case "$1" in
    ubuntu*) echo 'RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends zsh fish && rm -rf /var/lib/apt/lists/*' ;;
    alpine*) echo 'RUN apk add --no-cache bash zsh fish' ;;
    rockylinux*) echo 'RUN dnf install -y --setopt=install_weak_deps=False zsh && dnf clean all' ;;
    esac
}

for image in $images; do
    echo "rust-tests: $image"
    tag="trc-rust-tests-$(echo "$image" | tr ':/' '--')"
    printf 'FROM %s\n%s\n' "$image" "$(shells_for "$image")" | docker build -q -t "$tag" - >/dev/null
    docker run --rm -v "$root/target:$root/target:ro" "$tag" sh -c '
        cd /tmp
        for binary in '"$(echo "$binaries" | tr '\n' ' ')"'; do
            "$binary" --test-threads=8 "$@" >/tmp/out 2>&1 || { cat /tmp/out; exit 1; }
            printf "%s: %s\n" "${binary##*/}" "$(grep "^test result" /tmp/out)"
        done' rust-tests "$@"
done

for bundle in linux-x64:amd64 linux-arm64:arm64; do
    dir=$root/apps/desktop/resources/daemon/${bundle%%:*}
    [ -x "$dir/trcd" ] || continue
    printf 'rust-tests: bundled %s: ' "${bundle%%:*}"
    docker run --rm --platform "linux/${bundle##*:}" -v "$dir:/d:ro" alpine:3.23 /d/trcd --version
done

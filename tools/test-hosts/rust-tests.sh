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

for image in $images; do
    echo "rust-tests: $image"
    docker run --rm -v "$root/target:$root/target:ro" "$image" sh -c '
        cd /tmp
        for binary in '"$(echo "$binaries" | tr '\n' ' ')"'; do
            "$binary" --test-threads=8 "$@" >/tmp/out 2>&1 || { cat /tmp/out; exit 1; }
            printf "%s: %s\n" "${binary##*/}" "$(grep "^test result" /tmp/out)"
        done' rust-tests "$@"
done

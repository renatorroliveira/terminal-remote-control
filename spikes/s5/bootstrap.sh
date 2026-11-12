# trc bootstrap prototype (spike S5). The app prepends: nonce=...; root=...
umask 077

say() {
    printf '%s %s\n' "$nonce" "$*"
}

fail() {
    say "ERROR $*"
    exit 1
}

detect_arch() {
    case $(uname -m) in
        x86_64 | amd64) echo x86_64 ;;
        aarch64 | arm64) echo arm64 ;;
        *) echo unsupported ;;
    esac
}

detect_checksum() {
    if command -v sha256sum >/dev/null 2>&1; then
        echo sha256sum
    elif command -v shasum >/dev/null 2>&1; then
        echo shasum
    elif command -v openssl >/dev/null 2>&1; then
        echo openssl
    else
        echo none
    fi
}

checksum() {
    case $tool in
        sha256sum) sha256sum "$1" | cut -d' ' -f1 ;;
        shasum) shasum -a 256 "$1" | cut -d' ' -f1 ;;
        openssl) openssl dgst -sha256 "$1" | sed 's/^.*= *//' ;;
    esac
}

installed_versions() {
    list=
    for dir in "$root"/versions/*/; do
        [ -x "${dir}trcd" ] || continue
        name=${dir%/}
        list="$list${list:+,}${name##*/}"
    done
    echo "${list:--}"
}

take_lock() {
    lock="$root/install.lock"
    attempts=0
    until mkdir "$lock" 2>/dev/null; do
        owner=$(cat "$lock/pid" 2>/dev/null)
        if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
            rm -rf "$lock"
            continue
        fi
        attempts=$((attempts + 1))
        [ "$attempts" -lt 50 ] || fail "lock busy $lock"
        sleep 0.2
    done
    echo $$ >"$lock/pid"
    held_lock=$lock
}

read_exact() {
    if command -v head >/dev/null 2>&1 && head -c 0 </dev/null >/dev/null 2>&1; then
        head -c "$1" >"$2"
    else
        dd bs=1 count="$1" of="$2" 2>/dev/null
    fi
}

cleanup() {
    [ -n "${staging:-}" ] && rm -rf "$staging"
    [ -n "${held_lock:-}" ] && rm -rf "$held_lock"
}

upload() {
    size=$1 sum=$2 version=$3
    [ "$tool" != none ] || fail "missing checksum tool: need sha256sum, shasum or openssl"
    take_lock
    staging=$(mktemp -d "$root/versions/.staging.XXXXXX") || fail "cannot create staging directory in $root/versions"
    say "PROGRESS receiving $size"
    read_exact "$size" "$staging/trcd"
    actual=$(wc -c <"$staging/trcd" | tr -d ' ')
    [ "$actual" = "$size" ] || fail "short upload $actual of $size bytes"
    say "PROGRESS verifying"
    [ "$(checksum "$staging/trcd")" = "$sum" ] || fail "checksum mismatch"
    chmod 0700 "$staging" "$staging/trcd"
    say "PROGRESS testing"
    "$staging/trcd" --version >/dev/null 2>&1
    status=$?
    [ "$status" -ne 126 ] || fail "noexec $root"
    [ "$status" -eq 0 ] || fail "selftest exit $status"
    if [ -d "$root/versions/$sum" ]; then
        rm -rf "$staging"
    else
        mv "$staging" "$root/versions/$sum" || fail "cannot install into $root/versions/$sum"
    fi
    staging=
    rm -rf "$held_lock"
    held_lock=
    say "INSTALLED $sum $version"
}

main() {
    trap cleanup EXIT
    trap 'exit 1' HUP INT TERM
    arch=$(detect_arch)
    tool=$(detect_checksum)
    os=$(uname -s)
    mkdir -p "$root/versions" 2>/dev/null || fail "cannot create $root"
    chmod 0700 "$root" "$root/versions"
    say "HELLO os=$os arch=$arch checksum=$tool installed=$(installed_versions)"
    [ "$os" = Linux ] || fail "unsupported os $os"
    [ "$arch" != unsupported ] || fail "unsupported arch $(uname -m)"
    while IFS=' ' read -r command a b c; do
        case $command in
            UPLOAD) upload "$a" "$b" "$c" ;;
            RUN)
                bin="$root/versions/$a/trcd"
                [ -x "$bin" ] || fail "not installed $a"
                trap - EXIT HUP INT TERM
                say "RUNNING"
                exec "$bin" bridge
                ;;
            EXIT) exit 0 ;;
            *) fail "unknown command $command" ;;
        esac
    done
}

main

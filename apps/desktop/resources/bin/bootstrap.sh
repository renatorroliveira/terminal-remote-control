# Terminal Remote Control bootstrap (US-1.4, TECH_STACK §7). The app pipes this
# script to `exec /bin/sh -s` over `ssh -T`, after two lines that set TRC_NONCE
# and TRC_ROOT. Every line for the app starts with the nonce; anything else,
# such as startup-file noise, is ignored. The app sends one command per line:
#   UPLOAD <size> <sha256> <version>, then exactly <size> bytes
#   RUN <sha256>
#   EXIT
# Errors are `ERROR <code> <detail>`. A failed run leaves nothing behind.
# Nothing under the install location runs, or is even reported, unless the
# location, its versions directory, the version directory and the binary are
# all the user's own and writable by no one else (SEC-04.4).
umask 077

say() {
    printf '%s %s\n' "$TRC_NONCE" "$*"
}

fail() {
    say "ERROR $*"
    exit 1
}

resolve_root() {
    case $TRC_ROOT in
    "~") root=$HOME ;;
    "~/"*) root=$HOME/${TRC_ROOT#"~/"} ;;
    /*) root=$TRC_ROOT ;;
    *) fail "root-unusable the install location must be absolute or start with ~/: $TRC_ROOT" ;;
    esac
    root=${root%/}
}

detect_arch() {
    case $1 in
    x86_64 | amd64) echo x86_64 ;;
    aarch64 | arm64) echo arm64 ;;
    *) echo unsupported ;;
    esac
}

detect_checksum() {
    for candidate in sha256sum shasum openssl; do
        if command -v "$candidate" >/dev/null 2>&1; then
            echo "$candidate"
            return
        fi
    done
    echo none
}

checksum() {
    case $tool in
    sha256sum) sha256sum "$1" | cut -d' ' -f1 ;;
    shasum) shasum -a 256 "$1" | cut -d' ' -f1 ;;
    openssl) openssl dgst -sha256 "$1" | sed 's/^.*= *//' ;;
    esac
}

# Whether a path is the user's own, not a symbolic link, and writable by
# neither its group nor others: only then may the daemon run from it.
trusted() {
    [ -L "$1" ] && return 1
    [ -O "$1" ] || return 1
    case $(ls -ld "$1" | cut -c6,9) in
    *w*) return 1 ;;
    esac
    return 0
}

# Refuses an install location that exists and is not trusted, before anything
# in it is run.
check_root() {
    [ -L "$root" ] && fail "root-unusable $root is a symbolic link"
    [ -e "$root" ] || return 0
    [ -O "$root" ] || fail "root-unusable $root belongs to another user"
    trusted "$root" || fail "root-unusable $root is writable by other users"
}

installed_versions() {
    list=
    trusted "$root/versions" || {
        echo -
        return
    }
    for dir in "$root"/versions/*/; do
        trusted "${dir%/}" && trusted "${dir}trcd" && [ -x "${dir}trcd" ] || continue
        sum=${dir%/}
        sum=${sum##*/}
        [ "$(checksum "${dir}trcd")" = "$sum" ] || continue
        report=$("${dir}trcd" --version 2>/dev/null) || continue
        set -- $report
        [ "${1:-}" = trcd ] && [ -n "${2:-}" ] || continue
        list="$list${list:+,}$sum:$2"
    done
    echo "${list:--}"
}

make_dir() {
    [ -d "$1" ] && return 1
    mkdir "$1" 2>/dev/null || fail "root-unusable cannot create $1"
}

prepare_root() {
    [ -L "$root" ] && fail "root-unusable $root is a symbolic link"
    if make_dir "$root"; then
        created_root=1
    fi
    check_root
    if make_dir "$root/versions"; then
        created_versions=1
    fi
    trusted "$root/versions" || fail "root-unusable $root/versions is not yours alone"
}

take_lock() {
    lock=$root/install.lock
    attempts=0
    until mkdir "$lock" 2>/dev/null; do
        owner=$(cat "$lock/pid" 2>/dev/null)
        if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
            rm -rf "$lock"
            continue
        fi
        attempts=$((attempts + 1))
        [ "$attempts" -lt 60 ] || fail "lock-busy another install is running in $root"
        sleep 1
    done
    held_lock=$lock
    echo $$ >"$lock/pid"
}

read_exact() {
    if head -c 0 </dev/null >/dev/null 2>&1; then
        head -c "$1" >"$2"
    elif command -v dd >/dev/null 2>&1; then
        dd bs=1 count="$1" of="$2" 2>/dev/null
    else
        fail "missing-tool head or dd"
    fi
}

check_upload_arguments() {
    case $1 in
    '' | *[!0-9]*) fail "protocol bad size $1" ;;
    esac
    case $2 in
    *[!0-9a-f]*) fail "protocol bad checksum" ;;
    esac
    [ ${#2} -eq 64 ] || fail "protocol bad checksum"
    [ "$tool" != none ] || fail "missing-tool sha256sum, shasum or openssl"
    command -v mktemp >/dev/null 2>&1 || fail "missing-tool mktemp"
}

self_test() {
    expected=$2
    report=$("$1" --version 2>/dev/null)
    status=$?
    [ "$status" -ne 126 ] || fail "noexec $root"
    [ "$status" -eq 0 ] || fail "self-test the daemon exited with status $status"
    set -- $report
    [ "${3:-}" = "$expected" ] || fail "self-test the daemon reported checksum ${3:-none}"
}

upload() {
    check_upload_arguments "$1" "$2"
    prepare_root
    take_lock
    staging=$(mktemp -d "$root/versions/.staging.XXXXXX") || fail "root-unusable cannot write to $root/versions"
    say "PROGRESS receiving"
    read_exact "$1" "$staging/trcd"
    received=$(wc -c <"$staging/trcd" | tr -d ' ')
    [ "$received" = "$1" ] || fail "short-upload received $received of $1 bytes"
    say "PROGRESS verifying"
    [ "$(checksum "$staging/trcd")" = "$2" ] || fail "checksum-mismatch"
    chmod 0700 "$staging" "$staging/trcd"
    say "PROGRESS testing"
    self_test "$staging/trcd" "$2"
    if [ -d "$root/versions/$2" ]; then
        trusted "$root/versions/$2" || fail "root-unusable $root/versions/$2 is not yours alone"
        mv -f "$staging/trcd" "$root/versions/$2/trcd" || fail "root-unusable cannot install into $root/versions/$2"
        rm -rf "$staging"
    else
        mv "$staging" "$root/versions/$2" || fail "root-unusable cannot install into $root/versions"
    fi
    staging=
    rm -rf "$held_lock"
    held_lock=
    say "INSTALLED $2 $3"
}

run_bridge() {
    case $1 in
    '' | *[!0-9a-f]*) fail "protocol bad checksum" ;;
    esac
    bin=$root/versions/$1/trcd
    [ -x "$bin" ] || fail "not-installed $1"
    trusted "$root/versions" && trusted "$root/versions/$1" && trusted "$bin" ||
        fail "root-unusable $root/versions/$1 is not yours alone"
    trap - EXIT HUP INT TERM
    say "RUNNING"
    exec "$bin" bridge
}

cleanup() {
    [ -n "${staging:-}" ] && rm -rf "$staging"
    [ -n "${held_lock:-}" ] && rm -rf "$held_lock"
    [ -n "${created_versions:-}" ] && rmdir "$root/versions" 2>/dev/null
    [ -n "${created_root:-}" ] && rmdir "$root" 2>/dev/null
    return 0
}

main() {
    trap cleanup EXIT
    trap 'exit 1' HUP INT TERM
    resolve_root
    check_root
    os=$(uname -s)
    machine=$(uname -m)
    arch=$(detect_arch "$machine")
    tool=$(detect_checksum)
    say "HELLO os=$os arch=$arch checksum=$tool installed=$(installed_versions)"
    [ "$os" = Linux ] || fail "unsupported-os $os $machine"
    [ "$arch" != unsupported ] || fail "unsupported-arch $os $machine"
    while read -r command first second third; do
        case $command in
        UPLOAD) upload "$first" "$second" "$third" ;;
        RUN) run_bridge "$first" ;;
        EXIT) exit 0 ;;
        *) fail "protocol unknown command" ;;
        esac
    done
}

main

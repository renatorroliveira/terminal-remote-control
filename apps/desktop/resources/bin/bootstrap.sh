# Terminal Remote Control bootstrap (US-1.4, TECH_STACK §7). The app pipes this
# script to `exec /bin/sh -s` over `ssh -T`, after two lines that set TRC_NONCE
# and TRC_ROOT. Every line for the app starts with the nonce; anything else,
# such as startup-file noise, is ignored. The app sends one command per line:
#   UPLOAD <size> <sha256> <version>, then exactly <size> bytes
#   RUN <sha256>
#   REMOVE
#   EXIT
# Errors are `ERROR <code> <detail>`. A failed run leaves nothing behind.
# `root-unsafe` means another user could change the install location;
# `root-unusable` means it cannot be created or written.
# Nothing under the install location runs, or is even reported, unless the
# location, its versions directory, the version directory and the binary are
# all the user's own and writable by no one else, and no folder above the
# location lets another user swap it (SEC-04.4).
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
    [ -n "$root" ] || fail "root-unusable the install location cannot be /"
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

# Whether a folder above the install location can be changed only by the user
# or root: owned by one of them, and writable by its group or others only with
# the sticky bit, which keeps others from renaming what is in it. OpenSSH asks
# the same of the folders above a key file.
safe_parent() {
    set -- "$1" $(ls -ldn "$1")
    [ "$4" = 0 ] || [ "$4" = "$uid" ] || return 1
    case $(printf '%s\n' "$2" | cut -c6,9,10) in
    ??[tT]) return 0 ;;
    *w*) return 1 ;;
    esac
    return 0
}

# Rewrites the install location over its folder's physical path, so no symbolic
# link above it is followed again, and refuses it when a folder from there up
# to / is not safe_parent: then no other user can swap the location between a
# check and a run.
check_parents() {
    parent=$(cd "${root%/*}/" 2>/dev/null && pwd -P) || fail "root-unusable ${root%/*} is missing or cannot be entered"
    parent=${parent%/}
    root=$parent/${root##*/}
    dir=${parent:-/}
    while :; do
        safe_parent "$dir" || fail "root-unsafe $dir lets other users change $root"
        [ "$dir" = / ] && return 0
        dir=${dir%/*}
        dir=${dir:-/}
    done
}

# Refuses an install location that exists and is not trusted, before anything
# in it is run.
check_root() {
    [ -L "$root" ] && fail "root-unsafe $root is a symbolic link"
    [ -e "$root" ] || return 0
    [ -O "$root" ] || fail "root-unsafe $root belongs to another user"
    trusted "$root" || fail "root-unsafe $root is writable by other users"
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
    [ -L "$root" ] && fail "root-unsafe $root is a symbolic link"
    if make_dir "$root"; then
        created_root=1
    fi
    check_root
    if make_dir "$root/versions"; then
        created_versions=1
    fi
    trusted "$root/versions" || fail "root-unsafe $root/versions is not yours alone"
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
        trusted "$root/versions/$2" || fail "root-unsafe $root/versions/$2 is not yours alone"
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
        fail "root-unsafe $root/versions/$1 is not yours alone"
    trap - EXIT HUP INT TERM
    say "RUNNING"
    exec "$bin" bridge
}

# The SHA-256 of a text, as the daemon names its systemd unit and LaunchAgent
# after its root's real path, with every symbolic link resolved.
hash_text() {
    case $tool in
    sha256sum) printf '%s' "$1" | sha256sum | cut -d' ' -f1 ;;
    shasum) printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1 ;;
    openssl) printf '%s' "$1" | openssl dgst -sha256 | sed 's/^.*= *//' ;;
    esac
}

# Ends every process run from this install's versions/, after stopping the
# core's systemd unit or removing its LaunchAgent (D-50), so neither restarts
# a core it is removing.
stop_processes() {
    stop_root_service
    for signal in TERM KILL; do
        found=
        for pid in $(install_processes); do
            kill -"$signal" "$pid" 2>/dev/null
            found=1
        done
        [ -n "$found" ] || return 0
        sleep 1
    done
}

# Stops the service named after the install root's real path, or after the
# root as check_parents rewrote it when the root itself is gone, as after the
# user deleted it, so its LaunchAgent never outlives it.
stop_root_service() {
    [ "$tool" != none ] || return 0
    canonical=$(cd "$root" 2>/dev/null && pwd -P) || canonical=$root
    stop_service "$(hash_text "$canonical" | cut -c1-8)"
}

# Stops the core's systemd unit, or boots out its LaunchAgent and deletes the
# agent's plist; $1 is the install root's short hash. A bootout launchd
# refuses while it starts the core is tried again for a few seconds, as a
# core still loaded would start again once the next step signals it.
stop_service() {
    if command -v systemctl >/dev/null 2>&1; then
        systemctl --user stop "trcd-$1.service" >/dev/null 2>&1
    fi
    if command -v launchctl >/dev/null 2>&1; then
        tries=0
        while launchctl print "gui/$uid/dev.trc.trcd-$1" >/dev/null 2>&1 && [ "$tries" -lt 5 ]; do
            launchctl bootout "gui/$uid/dev.trc.trcd-$1" >/dev/null 2>&1 || sleep 1
            tries=$((tries + 1))
        done
        agent=$HOME/Library/LaunchAgents/dev.trc.trcd-$1.plist
        if [ -f "$agent" ] && [ ! -L "$agent" ]; then
            rm -f "$agent"
        fi
    fi
}

# The processes whose executable lies in this install's versions/: from /proc
# on Linux, from ps on macOS, which has no /proc.
install_processes() {
    if [ -d /proc/self ]; then
        for proc in /proc/[0-9]*; do
            exe=$(readlink "$proc/exe" 2>/dev/null) || continue
            case $exe in
            "$root/versions/"*) echo "${proc#/proc/}" ;;
            esac
        done
        return 0
    fi
    ps -axo pid=,comm= | while read -r pid exe; do
        case $exe in
        "$root/versions/"*) echo "$pid" ;;
        esac
    done
}

# Whether $1 is $2 lowercase hexadecimal digits, as version and session names are.
is_hex() {
    [ "${#1}" -eq "$2" ] || return 1
    case $1 in
    *[!0-9a-f]*) return 1 ;;
    esac
}

# Whether the entry named $2 in TRC's folder $1 is one TRC creates.
owned() {
    case $1:$2 in
    versions:.staging.*) return 0 ;;
    versions:*) is_hex "$2" 64 ;;
    sessions:*) is_hex "$2" 16 ;;
    logs:core.*log | logs:launchd.log) return 0 ;;
    run:core.sock | run:core.lock | run:upgrade.lock) return 0 ;;
    holders:*.sock) is_hex "${2%.sock}" 16 ;;
    *) return 1 ;;
    esac
}

# Deletes the entries TRC creates in its folder $2 of kind $1, then the folder
# once it is empty; anything else stays.
remove_owned() {
    { [ -d "$2" ] && [ ! -L "$2" ]; } || return 0
    for entry in "$2"/* "$2"/.[!.]*; do
        { [ -e "$entry" ] || [ -L "$entry" ]; } || continue
        if [ "$1:${entry##*/}" = run:holders ] && [ ! -L "$entry" ]; then
            remove_owned holders "$entry"
        elif owned "$1" "${entry##*/}"; then
            rm -rf "$entry"
        fi
    done
    rmdir "$2" 2>/dev/null
    return 0
}

# Removes the daemon (US-3.3.3, P-46): ends its processes, then deletes only
# the entries TRC creates in the install location, and the location itself
# once it is empty, so a moved location never loses other files. Reports
# what it left.
remove_install() {
    [ -d "$root" ] || {
        stop_root_service
        say "REMOVED"
        return
    }
    stop_processes
    if [ -d "$root/run" ]; then
        remove_owned run "$root/run"
    elif [ -d "/tmp/trc-$uid" ] && [ -O "/tmp/trc-$uid" ] && [ ! -L "/tmp/trc-$uid" ]; then
        remove_owned run "/tmp/trc-$uid"
    fi
    for folder in versions sessions logs; do
        remove_owned "$folder" "$root/$folder"
    done
    if [ -d "$root/install.lock" ] && [ ! -L "$root/install.lock" ]; then
        rm -f "$root/install.lock/pid"
        rmdir "$root/install.lock" 2>/dev/null
    fi
    rmdir "$root" 2>/dev/null
    kept=
    [ -d "$root" ] && kept=$(ls -A "$root" | tr '\n' '/' | sed 's#/$##')
    if [ -n "$kept" ]; then
        say "REMOVED kept=$kept"
    else
        say "REMOVED"
    fi
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
    uid=$(id -u)
    resolve_root
    check_parents
    check_root
    os=$(uname -s)
    machine=$(uname -m)
    arch=$(detect_arch "$machine")
    tool=$(detect_checksum)
    say "HELLO os=$os arch=$arch checksum=$tool installed=$(installed_versions)"
    case $os in
    Linux | Darwin) ;;
    *) fail "unsupported-os $os $machine" ;;
    esac
    [ "$arch" != unsupported ] || fail "unsupported-arch $os $machine"
    while read -r command first second third; do
        case $command in
        UPLOAD) upload "$first" "$second" "$third" ;;
        RUN) run_bridge "$first" ;;
        REMOVE) remove_install ;;
        EXIT) exit 0 ;;
        *) fail "protocol unknown command" ;;
        esac
    done
}

main

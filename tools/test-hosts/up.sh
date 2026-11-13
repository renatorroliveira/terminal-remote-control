#!/bin/sh
# Starts the Linux test hosts on the colima profile `trc` with fresh keys.
# Writes .run/ssh_config, which every test passes to ssh with -F.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
run="$here/.run"
export DOCKER_CONTEXT="${DOCKER_CONTEXT:-colima-trc}"

rm -rf "$run"
mkdir -p "$run/keys-public"
chmod 0700 "$run"

new_key() {
    ssh-keygen -q -t ed25519 -N "$2" -C "trc-test-$1" -f "$run/$1"
}

new_key id_ed25519 ''
new_key id_ed25519_pass 'trc-test-passphrase'
new_key id_rejected ''
new_key id_cert ''
new_key id_expired ''
new_key ca ''
ssh-keygen -q -s "$run/ca" -I trc-valid -n tester -V -1d:+30d "$run/id_cert.pub"
ssh-keygen -q -s "$run/ca" -I trc-expired -n tester -V -3d:-1d "$run/id_expired.pub"

cat "$run/id_ed25519.pub" "$run/id_ed25519_pass.pub" > "$run/keys-public/authorized_keys"
cp "$run/ca.pub" "$run/keys-public/ca.pub"
: > "$run/known_hosts"

while IFS= read -r line; do
    if [ "$line" = @SCALE_HOSTS@ ]; then
        for n in $(seq -w 1 25); do
            printf 'Host trc-scale-%s\n    Port 2227\n    User u%s\n\n' "$n" "$n"
        done
    else
        printf '%s\n' "$line" | sed "s|@RUN@|$run|g"
    fi
done < "$here/ssh_config.in" > "$run/ssh_config"

docker compose -f "$here/compose.yaml" up -d --build --wait --force-recreate >/dev/null 2>"$run/compose.log" || {
    cat "$run/compose.log" >&2
    exit 1
}

smoke_ssh() {
    ssh -F "$run/ssh_config" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
        -o UserKnownHostsFile="$run/known_hosts.smoke" "$@" true >/dev/null 2>&1
}

smoke_check() {
    if [ "$1" = trc-behind ]; then
        smoke_ssh -o ProxyCommand="ssh -F $run/ssh_config -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
-o UserKnownHostsFile=$run/known_hosts.smoke -W %h:%p trc-jump" "$1"
    else
        smoke_ssh "$1"
    fi
}

for alias in trc-ubuntu trc-ubuntu-nss trc-alpine trc-rocky trc-noexec trc-latency trc-scale-01 trc-scale-25 trc-jump trc-behind; do
    attempt=0
    until smoke_check "$alias"; do
        attempt=$((attempt + 1))
        if [ "$attempt" -ge 20 ]; then
            echo "test host $alias did not accept ssh" >&2
            exit 1
        fi
        sleep 0.5
    done
done
echo "test hosts ready: $run/ssh_config"

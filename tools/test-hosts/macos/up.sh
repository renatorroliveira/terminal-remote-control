#!/bin/sh
# Starts the macOS test host (P-57): a tart VM cloned from the pinned base image, on lima's user-mode network with
# its SSH port forwarded to 127.0.0.1 only (P-67), with Rosetta, and two users who sign in with the Linux test
# hosts' key: admin, whom the image logs in to the GUI at boot, and trcnogui, who never has a GUI login. Password
# logins are turned off once the key is in. Writes ../.run/macos.ssh_config, which the test hosts' ssh_config
# includes, so run tools/test-hosts/up.sh first; tools/test-hosts/macos/down.sh deletes the VM.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
run="$here/.run"
hosts="$here/../.run"
image=ghcr.io/cirruslabs/macos-tahoe-vanilla@sha256:eeec54bfe1f076e27786c5d92b89187a05b1d109b5071eb2dcdf02d596e34640
vm=trc-mac
port=2230
address=192.168.105.10

[ -f "$hosts/id_ed25519" ] || {
    echo "start the Linux test hosts first: tools/test-hosts/up.sh" >&2
    exit 1
}
"$here/down.sh"
mkdir -p "$run"
chmod 0700 "$run"

wait_for() {
    tries=0
    until eval "$1"; do
        tries=$((tries + 1))
        [ "$tries" -lt "$2" ] || {
            echo "timed out: $1" >&2
            exit 1
        }
        sleep 1
    done
}

received() {
    curl -fsS --unix-socket "$run/api.sock" http://usernet/stats 2>/dev/null |
        sed -n 's/.*"BytesReceived":\([0-9]*\).*/\1/p'
}

# Starts a fresh user-mode network and the VM on it, and waits until the VM sends frames; a usernet serves one VM
# start, and a just-cloned VM can miss its first, so both start again, up to 3 times.
start_vm() {
    for attempt in 1 2 3; do
        tart stop "$vm" >/dev/null 2>&1 || true
        if [ -f "$run/usernet.pid" ]; then
            kill "$(cat "$run/usernet.pid")" 2>/dev/null || true
        fi
        rm -f "$run/usernet.sock" "$run/api.sock" "$run/usernet.pid"
        nohup limactl usernet -p "$run/usernet.pid" -e "$run/api.sock" --listen "$run/usernet.sock" \
            --subnet 192.168.105.0/24 --leases "$address=$mac" >"$run/usernet.log" 2>&1 &
        wait_for '[ -S "$run/usernet.sock" ] && [ -S "$run/api.sock" ]' 30
        python3 -I "$here/net-fd.py" "$run/usernet.sock" "$(command -v tart)" "$vm" "$run/tart.log"
        tries=0
        while [ "$(received)" = 0 ] && [ "$tries" -lt 90 ]; do
            tries=$((tries + 1))
            sleep 1
        done
        [ "$(received)" = 0 ] || return 0
        echo "the VM sent nothing on attempt $attempt; starting it again" >&2
    done
    echo "the VM never reached its network" >&2
    exit 1
}

tart clone "$image" "$vm"
mac=$(tart get "$vm" --format json | sed -n 's/.*"MACAddress" *: *"\([^"]*\)".*/\1/p')
start_vm
curl -fsS --unix-socket "$run/api.sock" -X POST http://usernet/services/forwarder/expose \
    -d "{\"local\":\"127.0.0.1:$port\",\"remote\":\"$address:22\",\"protocol\":\"tcp\"}" >/dev/null
wait_for 'ssh-keyscan -T 2 -p "$port" 127.0.0.1 2>/dev/null | grep -q ssh-ed25519' 120
ssh-keyscan -T 5 -p "$port" 127.0.0.1 2>/dev/null | grep -v '^#' | sed "s/^\[127\.0\.0\.1\]:$port/trc-mac/" >"$run/known_hosts"

printf '#!/bin/sh\necho admin\n' >"$run/askpass"
chmod 0700 "$run/askpass"
SSH_ASKPASS="$run/askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=none \
    ssh -F /dev/null -p "$port" -o HostKeyAlias=trc-mac -o UserKnownHostsFile="$run/known_hosts" \
    -o StrictHostKeyChecking=yes -o PubkeyAuthentication=no \
    -o PreferredAuthentications=password,keyboard-interactive admin@127.0.0.1 \
    'umask 077; mkdir -p ~/.ssh && cat >>~/.ssh/authorized_keys' <"$hosts/id_ed25519.pub"
rm -f "$run/askpass"

cat >"$run/ssh_config" <<CONFIG
Host trc-mac-gui trc-mac-nogui
    HostName 127.0.0.1
    Port $port
    HostKeyAlias trc-mac
    IdentityFile $hosts/id_ed25519
    IdentitiesOnly yes
    UserKnownHostsFile $hosts/known_hosts
    ConnectTimeout 5

Host trc-mac-gui
    User admin

Host trc-mac-nogui
    User trcnogui
CONFIG

admin() {
    ssh -F "$run/ssh_config" -o BatchMode=yes -o UserKnownHostsFile="$run/known_hosts" trc-mac-gui "$1"
}
admin 'set -e
nogui=$(dirname "$HOME")/trcnogui
password=$(LC_ALL=C tr -dc A-Za-z0-9 </dev/urandom | head -c 24)
sudo sysadminctl -addUser trcnogui -fullName "TRC no GUI" -password "$password" -home "$nogui" \
    -shell /bin/zsh >/dev/null 2>&1
sudo createhomedir -c -u trcnogui >/dev/null 2>&1 || true
sudo dseditgroup -o edit -a trcnogui -t user com.apple.access_ssh
sudo mkdir -p "$nogui/.ssh"
sudo cp ~/.ssh/authorized_keys "$nogui/.ssh/authorized_keys"
sudo chown -R trcnogui:staff "$nogui/.ssh"
sudo chmod 700 "$nogui/.ssh"
sudo chmod 600 "$nogui/.ssh/authorized_keys"
printf "PasswordAuthentication no\nKbdInteractiveAuthentication no\n" | sudo tee /etc/ssh/sshd_config.d/100-trc.conf >/dev/null
sudo launchctl kickstart -k system/com.openssh.sshd
sudo softwareupdate --install-rosetta --agree-to-license >/dev/null 2>&1'

cp "$run/ssh_config" "$hosts/macos.ssh_config"
for file in known_hosts known_hosts.smoke; do
    sed -i '' '/^trc-mac /d' "$hosts/$file"
    cat "$run/known_hosts" >>"$hosts/$file"
done
for alias in trc-mac-gui trc-mac-nogui; do
    wait_for "ssh -F '$hosts/ssh_config' -o BatchMode=yes -o UserKnownHostsFile='$hosts/known_hosts.smoke' $alias true" 30
done
echo "macOS test host up: trc-mac-gui (GUI login), trc-mac-nogui (none)"

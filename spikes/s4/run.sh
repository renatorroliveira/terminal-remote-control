#!/bin/bash
# Spike S4: run every US-1.2/US-1.3 case with the production ssh arguments and record stderr.
here=$(cd "$(dirname "$0")" && pwd)
run=$(cd "$here/../../tools/test-hosts/.run" && pwd)
out="$here/../../docs/spikes/s4"
mkdir -p "$out"
export TRC_NONCE=n0nce

wrapper() {
    cat <<CONF
Host *
    BatchMode yes
    StrictHostKeyChecking yes
    KnownHostsCommand "$here/known-hosts" %I %H %t %K %f
    UserKnownHostsFile $1
    PreferredAuthentications publickey
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    ForwardAgent no
    ForwardX11 no
    ClearAllForwardings yes
    PermitLocalCommand no
    LogLevel ERROR

Include $run/ssh_config
CONF
}

trc_ssh() {
    local alias=$1 known=$2; shift 2
    wrapper "$known" > "$run/wrapper.s4.conf"
    SSH_ASKPASS="$here/askpass" SSH_ASKPASS_REQUIRE=force DISPLAY= \
    /usr/bin/ssh -F "$run/wrapper.s4.conf" -T -e none -o BatchMode=yes -o StrictHostKeyChecking=yes \
        -o "KnownHostsCommand=$here/known-hosts %I %H %t %K %f" \
        -o UserKnownHostsFile="$known" \
        -o PreferredAuthentications=publickey -o PasswordAuthentication=no \
        -o KbdInteractiveAuthentication=no -o ForwardAgent=no -o ForwardX11=no \
        -o ClearAllForwardings=yes -o PermitLocalCommand=no \
        -o ServerAliveInterval=10 -o ServerAliveCountMax=2 -o ConnectTimeout=5 \
        -o LogLevel=ERROR "$@" "$alias" 'echo CONNECTED' </dev/null
}

record() {
    local name=$1; shift
    local errfile; errfile=$(mktemp)
    local stdout; stdout=$("$@" 2>"$errfile"); local code=$?
    {
        echo "case: $name"
        echo "exit: $code"
        echo "stdout: $(printf '%s' "$stdout" | grep -v Welcome | tr '\n' ' ')"
        echo "stderr:"
        sed "s|$run|<run>|g; s|$here|<app>|g; s|$HOME|~|g" "$errfile"
    } > "$out/$name.txt"
    rm -f "$errfile"
    printf '%-28s exit=%-3s %s\n' "$name" "$code" "$(grep -v '^n0nce' "$out/$name.txt" | sed -n '5p' | cut -c1-90)"
}

known_ok="$run/known_hosts.s4"
cp "$run/known_hosts.smoke" "$known_ok"
grep -h "2225" "$run/known_hosts.smoke" > "$run/known_hosts.jumponly"
cp "$run/known_hosts.jump" "$run/known_hosts.jumpall"
empty=$(mktemp)

agent_start() { eval "$(ssh-agent -s)" >/dev/null; }
agent_stop() { ssh-agent -k >/dev/null 2>&1; unset SSH_AGENT_PID SSH_AUTH_SOCK; }

record ok-ubuntu trc_ssh trc-ubuntu "$known_ok"
record hostkey-unknown trc_ssh trc-ubuntu "$empty"
changed="$run/known_hosts.changed"
sed -E 's/(ssh-ed25519 )[A-Za-z0-9+\/=]+/\1AAAAC3NzaC1lZDI1NTE5AAAAIKBVeLtBVHPhzDUjnYTmCAPCnBHYALUbm5a3Lh8KrG3T/' "$known_ok" > "$changed"
record hostkey-changed trc_ssh trc-ubuntu "$changed"
record cert-ok trc_ssh trc-cert "$known_ok"
record cert-expired trc_ssh trc-expired "$known_ok"
record key-rejected trc_ssh trc-rejected "$known_ok"
( unset SSH_AUTH_SOCK; record no-agent-passphrase-key trc_ssh trc-pass "$known_ok" )
( agent_start; record agent-empty-passphrase-key trc_ssh trc-pass "$known_ok"; ssh-add -l >/dev/null 2>&1; echo "  ssh-add -l exit with empty agent: $?"; agent_stop )
( unset SSH_AUTH_SOCK; ssh-add -l >/dev/null 2>&1; echo "  ssh-add -l exit with no agent: $?" )
( agent_start; SSH_ASKPASS= ssh-add -q "$run/id_ed25519" </dev/null; ssh-add -l >/dev/null 2>&1; echo "  ssh-add -l exit with a key: $?"; agent_stop )
( agent_start; printf '#!/bin/sh\necho trc-test-passphrase\n' > "$run/pass.sh"; chmod +x "$run/pass.sh"; SSH_ASKPASS="$run/pass.sh" SSH_ASKPASS_REQUIRE=force ssh-add -q "$run/id_ed25519_pass" </dev/null; record agent-loaded-passphrase-key trc_ssh trc-pass "$known_ok"; agent_stop )
record dns-failure trc_ssh trc-dns "$known_ok"
record host-unreachable trc_ssh trc-unreachable "$known_ok"
record timeout trc_ssh trc-timeout "$known_ok"
record jump-hostkey-unknown-jump trc_ssh trc-behind "$empty"
record jump-hostkey-unknown-target trc_ssh trc-behind "$run/known_hosts.jumponly"
record jump-ok trc_ssh trc-behind "$known_ok"
record jump-failure trc_ssh trc-badjump "$known_ok"
record forwarding-disabled-exec trc_ssh trc-alpine "$known_ok"
rm -f "$empty"

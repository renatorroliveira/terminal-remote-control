#!/bin/sh
# Prepares a test host at start: host keys, the test CA, user keys, then sshd.
set -eu

ssh-keygen -A >/dev/null
install -m 0644 /trc-keys/ca.pub /etc/ssh/trc_user_ca.pub

if [ "${TRC_ALLOW_FORWARDING:-0}" = 1 ]; then
    sed -i 's/^DisableForwarding yes/DisableForwarding no/' /etc/ssh/sshd_config
fi

for user in ${TRC_USERS:-tester}; do
    entry=$(getent passwd "$user")
    home=$(printf '%s' "$entry" | cut -d: -f6)
    group=$(id -g "$user")
    mkdir -p "$home/.ssh"
    install -m 0600 /trc-keys/authorized_keys "$home/.ssh/authorized_keys"
    if [ -f /trc-skel/.bashrc ]; then
        install -m 0644 /trc-skel/.bashrc "$home/.bashrc"
    fi
    chown -R "$user:$group" "$home"
    chmod 0700 "$home" "$home/.ssh"
done

mkdir -p /run/sshd
exec /usr/sbin/sshd -D -e

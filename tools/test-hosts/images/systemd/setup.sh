#!/bin/sh
# Prepares the systemd test host at boot (P-32): host keys, the test CA and user keys as on the other hosts, then
# lingering for tester when TRC_LINGER=1 and logind's KillUserProcesses when TRC_KILL_USER_PROCESSES=1. The settings
# come from PID 1's environment, which is the container's.
set -eu

setting() {
    tr '\0' '\n' < /proc/1/environ | sed -n "s/^$1=//p"
}

ssh-keygen -A >/dev/null
install -m 0644 /trc-keys/ca.pub /etc/ssh/trc_user_ca.pub
install -d -m 0700 -o tester -g tester /home/tester/.ssh
install -m 0600 -o tester -g tester /trc-keys/authorized_keys /home/tester/.ssh/authorized_keys
mkdir -p /run/sshd

mkdir -p /var/lib/systemd/linger
if [ "$(setting TRC_LINGER)" = 1 ]; then
    touch /var/lib/systemd/linger/tester
else
    rm -f /var/lib/systemd/linger/tester
fi

mkdir -p /etc/systemd/logind.conf.d
if [ "$(setting TRC_KILL_USER_PROCESSES)" = 1 ]; then
    printf '[Login]\nKillUserProcesses=yes\n' > /etc/systemd/logind.conf.d/trc.conf
else
    printf '[Login]\nKillUserProcesses=no\n' > /etc/systemd/logind.conf.d/trc.conf
fi

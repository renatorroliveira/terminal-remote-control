FROM ubuntu:24.04
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        systemd systemd-sysv dbus dbus-user-session libpam-systemd openssh-server bash procps iproute2 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN useradd -m -s /bin/bash tester && usermod -p '*' tester \
    && systemctl enable ssh \
    && systemctl mask getty@tty1.service systemd-networkd-wait-online.service
COPY common/sshd_config /etc/ssh/sshd_config
RUN printf 'UsePAM yes\n' >> /etc/ssh/sshd_config
COPY systemd/setup.sh /usr/local/sbin/trc-setup
COPY systemd/trc-setup.service /etc/systemd/system/trc-setup.service
RUN systemctl enable trc-setup.service
EXPOSE 22
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]

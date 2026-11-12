FROM ubuntu:24.04
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        openssh-server bash zsh fish vim neovim less htop tmux git python3 procps iproute2 \
        libnss-extrausers ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN useradd -m -s /bin/bash tester && usermod -p '*' tester \
    && sed -i -E 's/^(passwd|group|shadow):(.*)$/\1:\2 extrausers/' /etc/nsswitch.conf \
    && mkdir -p /var/lib/extrausers /home/nssuser \
    && echo 'nssuser:x:2001:2001:NSS-only test user:/home/nssuser:/bin/bash' > /var/lib/extrausers/passwd \
    && echo 'nssuser:x:2001:' > /var/lib/extrausers/group \
    && echo 'nssuser:*:19000:0:99999:7:::' > /var/lib/extrausers/shadow \
    && chmod 0640 /var/lib/extrausers/shadow
COPY common/sshd_config /etc/ssh/sshd_config
COPY common/entrypoint.sh /usr/local/sbin/trc-entrypoint
COPY common/noisy.bashrc /trc-skel/.bashrc
EXPOSE 22
ENTRYPOINT ["/bin/sh", "/usr/local/sbin/trc-entrypoint"]

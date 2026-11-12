FROM rockylinux/rockylinux:9
RUN dnf install -y --setopt=install_weak_deps=False openssh-server procps-ng iproute \
    && dnf clean all \
    && useradd -m -s /bin/bash tester && usermod -p '*' tester
COPY common/sshd_config /etc/ssh/sshd_config
COPY common/entrypoint.sh /usr/local/sbin/trc-entrypoint
EXPOSE 22
ENTRYPOINT ["/bin/sh", "/usr/local/sbin/trc-entrypoint"]

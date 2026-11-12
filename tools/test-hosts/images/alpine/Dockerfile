FROM alpine:3.23
RUN apk add --no-cache openssh-server openssh-keygen \
    && adduser -D -s /bin/sh tester \
    && sed -i 's/^tester:!/tester:*/' /etc/shadow
COPY common/sshd_config /etc/ssh/sshd_config
COPY common/entrypoint.sh /usr/local/sbin/trc-entrypoint
EXPOSE 22
ENTRYPOINT ["/bin/sh", "/usr/local/sbin/trc-entrypoint"]

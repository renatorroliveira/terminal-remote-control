# Linux test hosts

sshd containers for the integration and end-to-end tests, run on a dedicated colima profile (TECH_STACK D-15).

```sh
colima start trc --vm-type vz --vz-rosetta --cpu 4 --memory 6   # once
tools/test-hosts/up.sh     # fresh keys, build, start, smoke-test every host
tools/test-hosts/down.sh   # stop and remove containers and generated keys
```

`rust-tests.sh` (`pnpm test:daemon`) builds the daemon's tests for Linux musl and runs every test binary as root in
plain Ubuntu, Alpine and Rocky containers, which also runs the Linux-only checks (no network sockets, memory) and the
other-user peer test. It needs only the colima profile, not the sshd hosts.

`up.sh` writes everything it generates to `tools/test-hosts/.run/` (git-ignored), including `ssh_config`, which tests
pass to ssh with `-F`. Ports are published on `127.0.0.1` only.

| Alias                                       | Host                                                      |
| ------------------------------------------- | --------------------------------------------------------- |
| `trc-ubuntu`                                | Ubuntu 24.04, bash, vim, neovim, htop, tmux, git, python3 |
| `trc-ubuntu-nss`                            | the same host as `nssuser`, known only through NSS        |
| `trc-alpine`                                | Alpine 3.23, busybox only                                 |
| `trc-rocky`                                 | Rocky Linux 9                                             |
| `trc-noexec`                                | Ubuntu with the home directory mounted `noexec`           |
| `trc-latency`                               | Ubuntu behind a 100 ms delay (`tc netem`, `NET_ADMIN`)    |
| `trc-scale-01` … `trc-scale-25`             | 25 users (`u01` … `u25`) on one Ubuntu host               |
| `trc-jump`                                  | the only host that allows forwarding                      |
| `trc-behind`                                | reachable only through `trc-jump` (`ProxyJump`)           |
| `trc-cert`                                  | certificate login signed by the run's test CA             |
| `trc-expired`                               | an expired certificate                                    |
| `trc-rejected`                              | a key the host does not accept                            |
| `trc-pass`                                  | a passphrase-protected key (`trc-test-passphrase`)        |
| `trc-badjump`                               | `ProxyJump` through an unreachable host                   |
| `trc-unreachable`, `trc-dns`, `trc-timeout` | connection failures                                       |

Every host except `trc-jump` sets `DisableForwarding yes`, so the product must work over exec channels alone
(US-1.5.3). The Ubuntu `tester` account prints a line from `.bashrc` on every login, to exercise the bootstrap's
startup-noise filter.

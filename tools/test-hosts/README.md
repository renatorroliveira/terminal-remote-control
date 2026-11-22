# Linux test hosts

sshd containers for the integration and end-to-end tests, run on a dedicated colima profile on macOS (TECH_STACK
D-15) and on Docker Desktop with its WSL 2 engine on Windows (D-69).

```sh
colima start trc --vm-type vz --vz-rosetta --cpu 4 --memory 6   # once, on macOS; on Windows start Docker Desktop
node tools/test-hosts/up.ts     # fresh keys, build, start, smoke-test every host
node tools/test-hosts/down.ts   # stop and remove containers and generated keys
```

`rust-tests.ts` (`pnpm test:daemon`) builds the daemon's tests for Linux musl and runs every test binary as root in
plain Ubuntu, Alpine and Rocky containers, which also runs the Linux-only checks (no network sockets, memory) and the
other-user peer test. It needs only the docker engine, not the sshd hosts.
`fetch-old-daemon.ts` puts the 0.2.0 release's daemons in the build cache for the upgrade tests.

`up.ts` writes everything it generates to `tools/test-hosts/.run/` (git-ignored), including `ssh_config`, which tests
pass to ssh with `-F`. On Windows it gives `.run` an ACL that only the user can read, since Windows OpenSSH refuses
private keys others can read. Ports are published on `127.0.0.1` only.

| Alias                                       | Host                                                      |
| ------------------------------------------- | --------------------------------------------------------- |
| `trc-ubuntu`                                | Ubuntu 24.04, bash, vim, neovim, htop, tmux, git, python3 |
| `trc-ubuntu-nss`                            | the same host as `nssuser`, known only through NSS        |
| `trc-alpine`                                | Alpine 3.23, busybox only                                 |
| `trc-rocky`                                 | Rocky Linux 9                                             |
| `trc-noexec`                                | Ubuntu with the home directory mounted `noexec`           |
| `trc-latency`                               | Ubuntu behind a 100 ms delay (`tc netem`, `NET_ADMIN`)    |
| `trc-systemd`                               | Ubuntu with systemd and logind, lingering off (P-32)      |
| `trc-systemd-linger`                        | the same with lingering on for `tester`                   |
| `trc-systemd-kill`                          | lingering off and logind's `KillUserProcesses=yes`        |
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
startup-noise filter. The `trc-systemd*` hosts run systemd as PID 1, which needs a privileged container on the
local test VM; their ports, like every other, are published on `127.0.0.1` only.

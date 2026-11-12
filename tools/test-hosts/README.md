# Linux test hosts

sshd containers for the integration and end-to-end tests, run on a dedicated colima profile (TECH_STACK D-15).

```sh
colima start trc --vm-type vz --vz-rosetta --cpu 4 --memory 6   # once
tools/test-hosts/up.sh     # fresh keys, build, start, smoke-test every host
tools/test-hosts/down.sh   # stop and remove containers and generated keys
```

`up.sh` writes everything it generates to `tools/test-hosts/.run/` (git-ignored), including `ssh_config`, which tests
pass to ssh with `-F`. Ports are published on `127.0.0.1` only.

| Alias             | Host                                                     |
| ----------------- | -------------------------------------------------------- |
| `trc-ubuntu`      | Ubuntu 24.04, bash, vim, neovim, htop, tmux, git, python3 |
| `trc-ubuntu-nss`  | the same host as `nssuser`, known only through NSS       |
| `trc-alpine`      | Alpine 3.23, busybox only                                |
| `trc-rocky`       | Rocky Linux 9                                            |
| `trc-noexec`      | Ubuntu with the home directory mounted `noexec`          |
| `trc-jump`        | the only host that allows forwarding                     |
| `trc-behind`      | reachable only through `trc-jump` (`ProxyJump`)          |
| `trc-cert`        | certificate login signed by the run's test CA            |
| `trc-expired`     | an expired certificate                                   |
| `trc-rejected`    | a key the host does not accept                           |
| `trc-pass`        | a passphrase-protected key (`trc-test-passphrase`)       |
| `trc-badjump`     | `ProxyJump` through an unreachable host                  |
| `trc-unreachable`, `trc-dns`, `trc-timeout` | connection failures            |

Every host except `trc-jump` sets `DisableForwarding yes`, so the product must work over exec channels alone
(US-1.5.3). The Ubuntu `tester` account prints a line from `.bashrc` on every login, to exercise the bootstrap's
startup-noise filter.

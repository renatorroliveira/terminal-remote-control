# E4 NFR verification and soak (ST-59)

Measured on 2026-11-17 and 18 on This computer, the owner's Mac, on the macOS test host (P-57) and on the Linux test
hosts, by `pnpm test:nfr`, the NFR tests with `TRC_NFR_HOST=local`, and the soak scenarios of `pnpm test:soak` and
`launchd.soak.test.ts`.
`node tools/nfr-report/nfr-report.ts` prints a run's table from `apps/desktop/nfr-results/results.jsonl`. E1's to
E3's results (`E1-nfr.md` to `E3-nfr.md`) describe the Linux hosts before E4, which changed code they run too (the
bridge, upgrades and the bootstrap); the Linux measurements and soaks below ran again on E4's builds.

## Conditions

| Item          | Value                                                                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client        | Apple M3 Pro, 36 GiB, macOS 26.7.3, display at 85 Hz                                                                                                                                     |
| This computer | The same Mac: the universal daemon from `pnpm build:daemon` installed in a scratch home, its core a temporary LaunchAgent in the user's GUI domain (P-58)                                |
| macOS host    | A tart VM of macOS 26.6.2, arm64, 4 CPUs, 8 GiB, on lima's user-mode network with SSH on `127.0.0.1:2230` (D-53); `trc-mac-gui` logs in to the GUI at boot, so its core is a LaunchAgent |
| Builds        | The app's test build (P-14), opened unseen in the screen's corner (D-27), for the UI half; the connection host in Node for the rest                                                      |
| Measurements  | Percentiles by nearest rank; memory in MiB, against NFR-09's "MB" targets                                                                                                                |

The rows named `local` are This computer: the harness reaches it as a live host named `local`. Its "connect again"
rows time the local shell and the daemon check, as no ssh runs.

## Results

`pnpm test:nfr` and the same tests with `TRC_NFR_HOST=local` ran on 2026-11-18 on `5201f60`'s daemon and test build,
nothing else of ours running on the machine. The later review fixes (`8a8170b` and round 4) changed only how a core that
cannot start exits, the bridge's error text and Remove daemon's bootout, none of which these measurements reach.

### This computer

| ID     | Measurement                                                                  | Value   | Target     |
| ------ | ---------------------------------------------------------------------------- | ------- | ---------- |
| NFR-01 | This computer: keystroke to its echo parsed in the app, p50                  | 1.5 ms  | —          |
| NFR-01 | This computer: keystroke to its echo parsed in the app, p95                  | 2.4 ms  | —          |
| NFR-01 | This computer: keystroke to its echo parsed in the app, p99                  | 3.9 ms  | ≤ 16.7 ms  |
| NFR-01 | This computer: keystroke to its echo on the text surface (next frame), p99   | 14.6 ms | next frame |
| NFR-09 | local: idle core, no sessions: resident memory                               | 2.9 MiB | ≤ 30 MB    |
| NFR-09 | local: idle core: CPU over 10 s                                              | 0.0 %   | ≤ 0.5%     |
| NFR-09 | local: per session (largest holder plus the core's growth), 10 idle sessions | 3.4 MiB | ≤ 10 MB    |
| NFR-05 | local: create a session, with up to 100 running, p95                         | 15.2 ms | —          |
| NFR-05 | local: rename to session event, 100 sessions, p95                            | 0.4 ms  | ≤ 250 ms   |
| NFR-05 | local: keystroke to echo with 101 sessions, p99                              | 1.1 ms  | ≤ 16.8 ms  |

- **NFR-09 on macOS** reads resident memory and CPU time with `ps`, as macOS has no `/proc`; the idle core is the
  universal binary's arm64 slice.

### Linux hosts

| ID     | Measurement                                                                                                                    | Value      | Target                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------- | -------------------------- |
| NFR-02 | trc-ubuntu: SSH round trip, ping to pong over the channel (median)                                                             | 0.9 ms     | —                          |
| NFR-02 | trc-ubuntu: keystroke to echo at the connection host, p99                                                                      | 6.1 ms     | ≤ 17.6 ms                  |
| NFR-02 | trc-latency: SSH round trip, ping to pong over the channel (median)                                                            | 104 ms     | —                          |
| NFR-02 | trc-latency: keystroke to echo at the connection host, p99                                                                     | 111 ms     | ≤ 120.5 ms                 |
| NFR-03 | trc-ubuntu: Ctrl+C under `python3` flood until the program reports it, p95                                                     | 46.1 ms    | ≤ 100 ms                   |
| S3b    | trc-ubuntu: output the app received under a 32 MiB flood, 1024 KiB credit window                                               | 55.0 MiB/s | —                          |
| S3b    | trc-ubuntu: time the program took to write the 32 MiB flood                                                                    | 608 ms     | never blocked (≤ 5,000 ms) |
| S3b    | trc-latency: output the app received under a 32 MiB flood, 1024 KiB credit window                                              | 1.8 MiB/s  | —                          |
| S3b    | trc-latency: time the program took to write the 32 MiB flood                                                                   | 387 ms     | never blocked (≤ 5,000 ms) |
| NFR-07 | trc-rocky paused: time until the app marks it disconnected                                                                     | 19.9 s     | ≤ 30 s                     |
| NFR-09 | trc-ubuntu: idle core, no sessions: resident memory                                                                            | 2.3 MiB    | ≤ 30 MB                    |
| NFR-09 | trc-ubuntu: idle core: CPU over 10 s                                                                                           | 0.0 %      | ≤ 0.5%                     |
| NFR-09 | trc-ubuntu: per session (largest holder plus the core's growth), 10 idle sessions                                              | 3.1 MiB    | ≤ 10 MB                    |
| NFR-10 | holder with the default 10,000 lines, full                                                                                     | 14.6 MiB   | bounded                    |
| NFR-10 | holder with the default 10,000 lines: growth after 40000 more lines                                                            | 0.4 MiB    | ≈ 0                        |
| NFR-10 | holder with the 100,000-line maximum, full                                                                                     | 106 MiB    | bounded                    |
| NFR-10 | holder with the 100,000-line maximum: growth after 300000 more lines                                                           | 3.5 MiB    | ≈ 0                        |
| NFR-09 | holder with the 100,000-line maximum: peak growth while a second client attaches from the start                                | 1.3 MiB    | ≤ 10 MB                    |
| NFR-09 | holder with the 100,000-line maximum, a full-screen program running: peak growth while a second client attaches from the start | 0.0 MiB    | ≤ 10 MB                    |
| NFR-09 | holder with the 100,000-line maximum, a full-screen program running: peak growth while the history follows the program's end   | 1.6 MiB    | ≤ 10 MB                    |
| NFR-09 | holder with the default 10,000 lines, a full-screen program running: peak growth while a second client attaches from the start | 0.0 MiB    | ≤ 10 MB                    |
| NFR-09 | holder with the default 10,000 lines, a full-screen program running: peak growth while the history follows the program's end   | 0.1 MiB    | ≤ 10 MB                    |
| NFR-05 | trc-ubuntu: create a session, with up to 100 running, p95                                                                      | 3.7 ms     | —                          |
| NFR-05 | trc-ubuntu: rename to session event, 100 sessions, p95                                                                         | 1.3 ms     | ≤ 250 ms                   |
| NFR-05 | trc-ubuntu: keystroke to echo with 101 sessions, p99                                                                           | 8.6 ms     | ≤ 17.5 ms                  |
| NFR-05 | 25 hosts: connect and install all at once                                                                                      | 1.6 s      | —                          |
| NFR-05 | 25 hosts: rename to session event, p95                                                                                         | 5.4 ms     | ≤ 250 ms                   |
| NFR-05 | 25 hosts: keystroke to echo, every keystroke on every host, p99                                                                | 8.0 ms     | ≤ 19.0 ms                  |
| NFR-08 | trc-ubuntu: output to its fdatasync'ed copy on disk, largest of 40 markers over a 1.2 MB flood                                 | 2.2 s      | ≤ 5 s                      |
| NFR-05 | trc-ubuntu: connected after a host restart to all 100 sessions restored and running                                            | 0.3 s      | —                          |
| NFR-05 | trc-ubuntu: host restart to all 100 sessions restored and running                                                              | 0.5 s      | —                          |
| SEC-08 | log files holding a typed, printed or environment canary                                                                       | 0.0 files  | 0                          |
| NFR-02 | trc-ubuntu: SSH round trip before the app types, ping to pong over the channel, p50                                            | 2.9 ms     | —                          |
| NFR-02 | trc-ubuntu: SSH round trip before the app types, ping to pong over the channel, p95                                            | 4.6 ms     | —                          |
| NFR-02 | trc-ubuntu: SSH round trip before the app types, ping to pong over the channel, p99                                            | 5.6 ms     | —                          |
| NFR-02 | trc-ubuntu: keystroke to its echo parsed in the app, p99                                                                       | 8.1 ms     | ≤ 21.2 ms                  |
| NFR-02 | trc-ubuntu: keystroke to its echo on the text surface (next frame), p99                                                        | 18.9 ms    | next frame                 |
| NFR-02 | trc-latency: SSH round trip before the app types, ping to pong over the channel, p50                                           | 107 ms     | —                          |
| NFR-02 | trc-latency: SSH round trip before the app types, ping to pong over the channel, p95                                           | 113 ms     | —                          |
| NFR-02 | trc-latency: SSH round trip before the app types, ping to pong over the channel, p99                                           | 116 ms     | —                          |
| NFR-02 | trc-latency: keystroke to its echo parsed in the app, p99                                                                      | 117 ms     | ≤ 129.9 ms                 |
| NFR-02 | trc-latency: keystroke to its echo on the text surface (next frame), p99                                                       | 123 ms     | next frame                 |
| NFR-03 | trc-ubuntu: Ctrl+C in the app to SIGINT in the flooding program, p95                                                           | 8.8 ms     | ≤ 100 ms                   |
| NFR-03 | trc-ubuntu: time between frames while the flood runs, p95                                                                      | 12.6 ms    | ≤ 100 ms                   |
| NFR-04 | trc-ubuntu, screen-reader mode: Return to the announcement of the output, p95                                                  | 119 ms     | ≤ 500 ms                   |
| NFR-06 | interactive window to a restored host reconnecting, worst of 5                                                                 | 28.2 ms    | ≤ 1,000 ms                 |
| NFR-07 | trc-ubuntu: ssh killed to the terminal attached again, worst of 5                                                              | 339 ms     | ≤ 5,000 ms                 |
| NFR-06 | launch to an interactive window (test build, Playwright included), worst of 5                                                  | 529 ms     | ≤ 2,000 ms                 |

## Soak under launchd (NFR-11, US-4.3)

`launchd.soak.test.ts` kills the LaunchAgent's core with SIGKILL 1,000 times, and has the core report an older
version 1,000 times so the next connection's bridge upgrades it (it boots the agent out, writes its plist and
bootstraps it), each with 3 sessions; every cycle checks that each session keeps its shell's PID, shows what it
printed while its core was down, and runs what is typed. `app.spec.ts` quits and crashes the app 50 times each with a
local session. The local and VM scenarios ran at the same time; every scenario lost no session.

| ID     | Measurement                                                              | Value    | Target     |
| ------ | ------------------------------------------------------------------------ | -------- | ---------- |
| NFR-11 | app launches on This computer: sessions lost in 50 quits and 50 crashes  | 0.0      | 0          |
| NFR-11 | daemon kill, LaunchAgent on local: sessions lost in 1000 cycles          | 0.0      | 0          |
| NFR-07 | daemon kill, LaunchAgent on local: connect again, p95 of 1000            | 1,030 ms | ≤ 5,000 ms |
| NFR-11 | daemon kill, LaunchAgent on trc-mac-gui: sessions lost in 1000 cycles    | 0.0      | 0          |
| NFR-07 | daemon kill, LaunchAgent on trc-mac-gui: connect again, p95 of 1000      | 923 ms   | ≤ 5,000 ms |
| NFR-11 | daemon upgrade, LaunchAgent on local: sessions lost in 1000 cycles       | 0.0      | 0          |
| NFR-07 | daemon upgrade, LaunchAgent on local: connect again, p95 of 1000         | 527 ms   | ≤ 5,000 ms |
| NFR-11 | daemon upgrade, LaunchAgent on trc-mac-gui: sessions lost in 1000 cycles | 0.0      | 0          |
| NFR-07 | daemon upgrade, LaunchAgent on trc-mac-gui: connect again, p95 of 1000   | 414 ms   | ≤ 5,000 ms |

The first review round (`9891b22`) changed how a core that cannot start exits under launchd, when a plist is replaced,
and how an upgrade checks the old core; the same scenarios then ran 100 cycles each on its daemon, again at the same
time on both hosts:

| ID     | Measurement                                                             | Value    | Target     |
| ------ | ----------------------------------------------------------------------- | -------- | ---------- |
| NFR-11 | daemon kill, LaunchAgent on local: sessions lost in 100 cycles          | 0.0      | 0          |
| NFR-07 | daemon kill, LaunchAgent on local: connect again, p95 of 100            | 1,036 ms | ≤ 5,000 ms |
| NFR-11 | daemon kill, LaunchAgent on trc-mac-gui: sessions lost in 100 cycles    | 0.0      | 0          |
| NFR-07 | daemon kill, LaunchAgent on trc-mac-gui: connect again, p95 of 100      | 934 ms   | ≤ 5,000 ms |
| NFR-11 | daemon upgrade, LaunchAgent on local: sessions lost in 100 cycles       | 0.0      | 0          |
| NFR-07 | daemon upgrade, LaunchAgent on local: connect again, p95 of 100         | 481 ms   | ≤ 5,000 ms |
| NFR-11 | daemon upgrade, LaunchAgent on trc-mac-gui: sessions lost in 100 cycles | 0.0      | 0          |
| NFR-07 | daemon upgrade, LaunchAgent on trc-mac-gui: connect again, p95 of 100   | 397 ms   | ≤ 5,000 ms |

## Soak on the final build (NFR-11)

Every scenario of `pnpm test:soak` and `launchd.soak.test.ts` ran again at 100 cycles, the Linux and launchd scenarios
at the same time, each on its own host, on `8a8170b`'s daemon and test build. The host restarts (20) and the app
launches (10 quits and 10 crashes on a Linux host and on This computer) ran afterwards on the round-4 build, which
`8a8170b` differs from only in how a core that cannot start exits, the bridge's error text and Remove daemon's bootout.
Every scenario lost no session.

| ID     | Measurement                                                                                                         | Value    | Target     |
| ------ | ------------------------------------------------------------------------------------------------------------------- | -------- | ---------- |
| NFR-11 | app quit (ssh connection closed) on trc-alpine: sessions lost in 100 cycles                                         | 0.0      | 0          |
| NFR-07 | app quit (ssh connection closed) on trc-alpine: connect again, p95 of 100                                           | 241 ms   | ≤ 5,000 ms |
| NFR-11 | network flap (connection stalled, then a new one) on trc-alpine: sessions lost in 100 cycles                        | 0.0      | 0          |
| NFR-07 | network flap (connection stalled, then a new one) on trc-alpine: connect again, p95 of 100                          | 247 ms   | ≤ 5,000 ms |
| NFR-11 | daemon kill, detached on trc-ubuntu: sessions lost in 100 cycles                                                    | 0.0      | 0          |
| NFR-07 | daemon kill, detached on trc-ubuntu: connect again, p95 of 100                                                      | 296 ms   | ≤ 5,000 ms |
| NFR-11 | app crash (ssh process killed) on trc-rocky: sessions lost in 100 cycles                                            | 0.0      | 0          |
| NFR-07 | app crash (ssh process killed) on trc-rocky: connect again, p95 of 100                                              | 279 ms   | ≤ 5,000 ms |
| NFR-11 | daemon kill, LaunchAgent on local: sessions lost in 100 cycles                                                      | 0.0      | 0          |
| NFR-07 | daemon kill, LaunchAgent on local: connect again, p95 of 100                                                        | 1,015 ms | ≤ 5,000 ms |
| NFR-11 | daemon kill, LaunchAgent on trc-mac-gui: sessions lost in 100 cycles                                                | 0.0      | 0          |
| NFR-07 | daemon kill, LaunchAgent on trc-mac-gui: connect again, p95 of 100                                                  | 914 ms   | ≤ 5,000 ms |
| NFR-11 | daemon kill, under systemd with lingering on trc-systemd-linger: sessions lost in 100 cycles                        | 0.0      | 0          |
| NFR-07 | daemon kill, under systemd with lingering on trc-systemd-linger: connect again, p95 of 100                          | 374 ms   | ≤ 5,000 ms |
| NFR-11 | daemon upgrade, LaunchAgent on local: sessions lost in 100 cycles                                                   | 0.0      | 0          |
| NFR-07 | daemon upgrade, LaunchAgent on local: connect again, p95 of 100                                                     | 447 ms   | ≤ 5,000 ms |
| NFR-11 | daemon upgrade 0.2.0 to this build, detached on trc-ubuntu: sessions lost in 100 cycles                             | 0.0      | 0          |
| NFR-07 | daemon upgrade 0.2.0 to this build, detached on trc-ubuntu: connect again, p95 of 100                               | 565 ms   | ≤ 5,000 ms |
| NFR-11 | daemon upgrade, LaunchAgent on trc-mac-gui: sessions lost in 100 cycles                                             | 0.0      | 0          |
| NFR-07 | daemon upgrade, LaunchAgent on trc-mac-gui: connect again, p95 of 100                                               | 370 ms   | ≤ 5,000 ms |
| NFR-11 | daemon upgrade 0.2.0 to this build, under systemd with lingering on trc-systemd-linger: sessions lost in 100 cycles | 0.0      | 0          |
| NFR-07 | daemon upgrade 0.2.0 to this build, under systemd with lingering on trc-systemd-linger: connect again, p95 of 100   | 669 ms   | ≤ 5,000 ms |
| NFR-11 | logout without lingering (KillUserProcesses=no) on trc-systemd: sessions lost in 100 cycles                         | 0.0      | 0          |
| NFR-07 | logout without lingering (KillUserProcesses=no) on trc-systemd: connect again, p95 of 100                           | 482 ms   | ≤ 5,000 ms |
| US-3.1 | trc-ubuntu: sessions lost or restored twice in 20 restarts                                                          | 0.0      | 0          |
| US-3.1 | trc-ubuntu: host restart to every session restored and taking input, p95 of 20                                      | 0.9 s    | —          |
| NFR-11 | app launches on trc-ubuntu: sessions lost in 10 quits and 10 crashes                                                | 0.0      | 0          |
| NFR-11 | app launches on This computer: sessions lost in 10 quits and 10 crashes                                             | 0.0      | 0          |

The kill and upgrade soaks end the core with SIGKILL and an upgrade; `tests/launchd.rs` also ends a LaunchAgent's core
with SIGTERM and with `launchctl stop`, and checks that launchd starts it again and that every session stays.

- **Found by the soak.** launchd respawns a `KeepAlive` job at most every 10 s by default, so a core killed within
  10 s of its start left the next connection waiting: the first short run measured 10.3 s at p95 on This computer and
  9.9 s on the VM, over NFR-07. The plist's `ThrottleInterval` of 1 s (`41d0466`, P-60) brought it to the values
  above.
- **Logout** (US-4.4.2, P-62): `mac-logout.integration.test.ts` logs `trc-mac-gui` out of the GUI, checks that the
  next connection's detached core adopts every shell with its output and input, then reboots the VM, whose user
  logs in again. Linux's logout soak ran at 100 cycles above, and at 1,000 in E3 (`E3-nfr.md`).
- **Upgrades** cannot start from an older macOS daemon, as 0.4.0 shipped none; the soak has the running core report
  0.0.1, which takes the bridge's upgrade path from there on.

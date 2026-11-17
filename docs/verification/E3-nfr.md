# E3 NFR verification and soak (ST-49)

Measured on 2026-11-17 by `pnpm test:nfr` and the soak scenarios against the test hosts (`tools/test-hosts`, P-04).
`node tools/nfr-report/nfr-report.ts` prints a run's table from `apps/desktop/nfr-results/results.jsonl`. E1's and
E2's results (`E1-nfr.md`, `E2-nfr.md`) still describe what E3 did not change.

## Conditions

| Item         | Value                                                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Client       | Apple M3 Pro, 36 GiB, macOS 26.7.3, display at 100 Hz, OpenSSH 10.5p1                                                                                                                                  |
| Test hosts   | colima profile `trc`: aarch64 VM, 4 CPUs, 6 GiB, Docker; Ubuntu 24.04, Rocky 9 and Alpine; `trc-systemd`, `trc-systemd-linger` and `trc-systemd-kill` (P-32)                                           |
| Network      | `127.0.0.1` port forwards into the VM; `trc-latency` adds 100 ms with `tc netem` (egress)                                                                                                              |
| Builds       | The app's test build (P-14), opened unseen in the screen's corner (D-27), for the UI half; the connection host in Node for the rest; the daemon from `pnpm build:daemon`, saving every session to disk |
| Measurements | Percentiles by nearest rank; NFR-02 at p99 over exactly 200 keystrokes (P-36); its round trip is the median ping over the host's SSH channel, or the link's own p95 in the UI test (P-35)              |
| Memory       | MiB; the tests hold NFR-09's "MB" targets as MiB                                                                                                                                                       |

## Results

One full run of `pnpm test:nfr` on `84a38fe`, nothing else running on the machine. Review rounds 3 and 4 then changed
how the core decides restores and retries records, and how a snapshot defers history when a full-screen program starts
while it streams, a case these runs don't reach.

| ID     | Measurement                                                                                                                    | Value      | Target                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------- | -------------------------- |
| SEC-08 | log files holding a typed, printed or environment canary                                                                       | 0.0 files  | 0                          |
| NFR-02 | trc-ubuntu: SSH round trip, ping to pong over the channel (median)                                                             | 0.6 ms     | —                          |
| NFR-02 | trc-ubuntu: keystroke to echo at the connection host, p99                                                                      | 7.0 ms     | ≤ 17.3 ms                  |
| NFR-02 | trc-latency: SSH round trip, ping to pong over the channel (median)                                                            | 106 ms     | —                          |
| NFR-02 | trc-latency: keystroke to echo at the connection host, p99                                                                     | 116 ms     | ≤ 123.0 ms                 |
| NFR-03 | trc-ubuntu: Ctrl+C under `python3` flood until the program reports it, p95                                                     | 12.3 ms    | ≤ 100 ms                   |
| S3b    | trc-ubuntu: output the app received under a 32 MiB flood, 1024 KiB credit window                                               | 38.0 MiB/s | —                          |
| S3b    | trc-ubuntu: time the program took to write the 32 MiB flood                                                                    | 872 ms     | never blocked (≤ 5,000 ms) |
| S3b    | trc-latency: output the app received under a 32 MiB flood, 1024 KiB credit window                                              | 1.9 MiB/s  | —                          |
| S3b    | trc-latency: time the program took to write the 32 MiB flood                                                                   | 359 ms     | never blocked (≤ 5,000 ms) |
| NFR-07 | trc-rocky paused: time until the app marks it disconnected                                                                     | 20.0 s     | ≤ 30 s                     |
| NFR-05 | trc-ubuntu: create a session, with up to 100 running, p95                                                                      | 4.4 ms     | —                          |
| NFR-05 | trc-ubuntu: rename to session event, 100 sessions, p95                                                                         | 1.1 ms     | ≤ 250 ms                   |
| NFR-05 | trc-ubuntu: keystroke to echo with 101 sessions, p99                                                                           | 12.3 ms    | ≤ 17.3 ms                  |
| NFR-05 | 25 hosts: connect and install all at once                                                                                      | 1.7 s      | —                          |
| NFR-05 | 25 hosts: rename to session event, p95                                                                                         | 5.6 ms     | ≤ 250 ms                   |
| NFR-05 | 25 hosts: keystroke to echo, every keystroke on every host, p99                                                                | 7.6 ms     | ≤ 18.7 ms                  |
| NFR-09 | idle core, no sessions: resident memory                                                                                        | 2.3 MiB    | ≤ 30 MB                    |
| NFR-09 | idle core: CPU over 10 s                                                                                                       | 0.0 %      | ≤ 0.5%                     |
| NFR-09 | per session (largest holder plus the core's growth), 10 idle sessions                                                          | 3.1 MiB    | ≤ 10 MB                    |
| NFR-10 | holder with the default 10,000 lines, full                                                                                     | 14.6 MiB   | bounded                    |
| NFR-10 | holder with the default 10,000 lines: growth after 40000 more lines                                                            | 0.5 MiB    | ≈ 0                        |
| NFR-10 | holder with the 100,000-line maximum, full                                                                                     | 105 MiB    | bounded                    |
| NFR-10 | holder with the 100,000-line maximum: growth after 300000 more lines                                                           | 3.5 MiB    | ≈ 0                        |
| NFR-09 | holder with the 100,000-line maximum: peak growth while a second client attaches from the start                                | 1.7 MiB    | ≤ 10 MB                    |
| NFR-09 | holder with the 100,000-line maximum, a full-screen program running: peak growth while a second client attaches from the start | 0.0 MiB    | ≤ 10 MB                    |
| NFR-09 | holder with the 100,000-line maximum, a full-screen program running: peak growth while the history follows the program's end   | 1.8 MiB    | ≤ 10 MB                    |
| NFR-09 | holder with the default 10,000 lines, a full-screen program running: peak growth while a second client attaches from the start | 0.0 MiB    | ≤ 10 MB                    |
| NFR-09 | holder with the default 10,000 lines, a full-screen program running: peak growth while the history follows the program's end   | 0.1 MiB    | ≤ 10 MB                    |
| NFR-05 | trc-ubuntu: connected after a host restart to all 100 sessions restored and running                                            | 0.3 s      | —                          |
| NFR-05 | trc-ubuntu: host restart to all 100 sessions restored and running                                                              | 0.6 s      | —                          |
| NFR-08 | trc-ubuntu: output to its fdatasync'ed copy on disk, largest of 40 markers over a 1.2 MB flood                                 | 2.2 s      | ≤ 5 s                      |
| NFR-02 | trc-ubuntu: SSH round trip before the app types, ping to pong over the channel, p50                                            | 3.4 ms     | —                          |
| NFR-02 | trc-ubuntu: SSH round trip before the app types, ping to pong over the channel, p95                                            | 5.6 ms     | —                          |
| NFR-02 | trc-ubuntu: SSH round trip before the app types, ping to pong over the channel, p99                                            | 5.7 ms     | —                          |
| NFR-02 | trc-ubuntu: keystroke to its echo parsed in the app, p99                                                                       | 7.5 ms     | ≤ 22.2 ms                  |
| NFR-02 | trc-ubuntu: keystroke to its echo on the text surface (next frame), p99                                                        | 20.5 ms    | next frame                 |
| NFR-02 | trc-latency: SSH round trip before the app types, ping to pong over the channel, p50                                           | 107 ms     | —                          |
| NFR-02 | trc-latency: SSH round trip before the app types, ping to pong over the channel, p95                                           | 116 ms     | —                          |
| NFR-02 | trc-latency: SSH round trip before the app types, ping to pong over the channel, p99                                           | 120 ms     | —                          |
| NFR-02 | trc-latency: keystroke to its echo parsed in the app, p99                                                                      | 120 ms     | ≤ 132.3 ms                 |
| NFR-02 | trc-latency: keystroke to its echo on the text surface (next frame), p99                                                       | 124 ms     | next frame                 |
| NFR-03 | trc-ubuntu: Ctrl+C in the app to SIGINT in the flooding program, p95                                                           | 40.1 ms    | ≤ 100 ms                   |
| NFR-03 | trc-ubuntu: time between frames while the flood runs, p95                                                                      | 12.7 ms    | ≤ 100 ms                   |
| NFR-04 | trc-ubuntu, screen-reader mode: Return to the announcement of the output, p95                                                  | 398 ms     | ≤ 500 ms                   |
| NFR-06 | interactive window to a restored host reconnecting, worst of 5                                                                 | 27.5 ms    | ≤ 1,000 ms                 |
| NFR-07 | trc-ubuntu: ssh killed to the terminal attached again, worst of 5                                                              | 343 ms     | ≤ 5,000 ms                 |
| NFR-06 | launch to an interactive window (test build, Playwright included), worst of 5                                                  | 630 ms     | ≤ 2,000 ms                 |

- **NFR-08** times each of 40 markers, printed between 30 KB floods, from the app seeing it to `scrollback.log` on
  the host holding it, polled every 100 ms; the largest lag is the value.
- **NFR-09's E2 exception is resolved** (ST-43, D-49). A client attaching while a full-screen program runs gets that
  program's screen only, so the holder grows by 0.0 MiB at both scrollback limits, against 95.3 MiB and 9.9 MiB in
  E2; the history it gets once the program ends streams within its credit and adds 1.8 MiB at the 100,000-line
  maximum.
- **NFR-05, restore at scale**: 100 sessions restored at once after `trc-ubuntu` restarts all run again within 0.6 s
  of the restart, 0.3 s after the connection (`restore.nfr.test.ts`).
- **SEC-08**: the canary run finds no canary under the daemon's `logs/` and `run/` or in the app's logs, and every
  saved file is 0600 in a 0700 folder.

## Soak with saving on (NFR-11, US-3.1)

E2's scenarios of `pnpm test:soak` ran again on `d4023ab`'s daemon and test build, with every session saving its
scrollback, beside `reboot.soak.test.ts`: 100 restarts of `trc-ubuntu` with 3 sessions that each print a cycle's
marker, checking each cycle that every session is restored once, shows its marker exactly once above a restore
marker, and takes input. The daemon, logout and first app-level scenarios ran at the same time on 2026-11-17, as in E2,
each on its own host in the one VM; until 04:07 UTC a leftover worker of an interrupted run also ran scenarios on the
same hosts, so the daemon scenarios' connect-again times include that load. The scenarios it overlapped (app quit,
app crash, network flap, the app launches, the detached daemon kill and the reboot soak) ran again afterwards, and
their reruns are the values below. Every scenario lost no session.

| ID     | Measurement                                                                                                                               | Value  | Target     |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- |
| NFR-11 | app launches on trc-ubuntu: sessions lost in 50 quits and 50 crashes                                                                      | 0.0    | 0          |
| NFR-11 | app quit (ssh connection closed) on trc-alpine: sessions lost in 1000 cycles                                                              | 0.0    | 0          |
| NFR-07 | app quit (ssh connection closed) on trc-alpine: connect again (ssh and daemon check), p95 of 1000                                         | 247 ms | ≤ 5,000 ms |
| NFR-11 | network flap (connection stalled, then a new one) on trc-alpine: sessions lost in 1000 cycles                                             | 0.0    | 0          |
| NFR-07 | network flap (connection stalled, then a new one) on trc-alpine: connect again (ssh and daemon check), p95 of 1000                        | 246 ms | ≤ 5,000 ms |
| NFR-11 | app crash (ssh process killed) on trc-rocky: sessions lost in 1000 cycles                                                                 | 0.0    | 0          |
| NFR-07 | app crash (ssh process killed) on trc-rocky: connect again (ssh and daemon check), p95 of 1000                                            | 337 ms | ≤ 5,000 ms |
| NFR-11 | logout without lingering (KillUserProcesses=no) on trc-systemd: sessions lost in 1000 cycles                                              | 0.0    | 0          |
| NFR-07 | logout without lingering (KillUserProcesses=no) on trc-systemd: connect again (ssh and daemon check), p95 of 1000                         | 331 ms | ≤ 5,000 ms |
| NFR-11 | daemon kill, detached on trc-ubuntu: sessions lost in 1000 cycles                                                                         | 0.0    | 0          |
| NFR-07 | daemon kill, detached on trc-ubuntu: connect again (ssh and daemon check), p95 of 1000                                                    | 366 ms | ≤ 5,000 ms |
| NFR-11 | daemon kill, under systemd with lingering on trc-systemd-linger: sessions lost in 1000 cycles                                             | 0.0    | 0          |
| NFR-07 | daemon kill, under systemd with lingering on trc-systemd-linger: connect again (ssh and daemon check), p95 of 1000                        | 349 ms | ≤ 5,000 ms |
| NFR-11 | daemon upgrade 0.2.0 to this build, detached on trc-ubuntu: sessions lost in 1000 cycles                                                  | 0.0    | 0          |
| NFR-07 | daemon upgrade 0.2.0 to this build, detached on trc-ubuntu: connect again (ssh and daemon check), p95 of 1000                             | 576 ms | ≤ 5,000 ms |
| NFR-11 | daemon upgrade 0.2.0 to this build, under systemd with lingering on trc-systemd-linger: sessions lost in 1000 cycles                      | 0.0    | 0          |
| NFR-07 | daemon upgrade 0.2.0 to this build, under systemd with lingering on trc-systemd-linger: connect again (ssh and daemon check), p95 of 1000 | 666 ms | ≤ 5,000 ms |
| US-3.1 | trc-ubuntu: sessions lost or restored twice in 100 restarts                                                                               | 0.0    | 0          |
| US-3.1 | trc-ubuntu: host restart to every session restored and taking input, p95 of 100                                                           | 0.9 s  | —          |

- A container restart keeps the VM's boot ID, so the reboot soak's restores say the processes ended rather than
  "after restart"; the boot-ID rule is unit-tested, and `host-restart.spec.ts` restarts all six Linux test hosts, the
  three systemd ones included. An earlier 100-restart run on `84a38fe`, waiting 31 s after each restore for the rule
  review round 3 dropped, also lost nothing (p95 0.8 s).
- The other scenarios are E2's (`E2-nfr.md`): the upgrade cycles start under 0.2.0's daemon, whose holders this
  build's core adopts 1,000 times on each host.

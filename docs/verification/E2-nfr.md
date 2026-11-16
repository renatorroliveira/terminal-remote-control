# E2 NFR verification and soak (ST-36)

Measured on 2026-11-15 by `pnpm test:nfr` and `pnpm test:soak` against the test hosts (`tools/test-hosts`, P-04),
on commit `0dea91e` plus the ST-36 changes to the harness. `node tools/nfr-report/nfr-report.ts` prints each run's
table from `apps/desktop/nfr-results/results.jsonl`. E1's results (`E1-nfr.md`) still describe what E2 did not
change.

## Conditions

| Item         | Value                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Client       | Apple M3 Pro, 36 GiB, macOS 26.7.3, display at 100 Hz, OpenSSH 10.5p1                                                                                                                            |
| Test hosts   | colima profile `trc`: aarch64 VM, 4 CPUs, 6 GiB, Docker; Ubuntu 24.04, Rocky 9 and Alpine; `trc-systemd` (lingering off) and `trc-systemd-linger` (P-32)                                         |
| Network      | `127.0.0.1` port forwards into the VM; `trc-latency` adds 100 ms with `tc netem` (egress)                                                                                                        |
| Builds       | The app's test build (P-14), opened unseen in the screen's corner (D-27), for the UI half and the app-launch soak; the connection host in Node for the rest; the daemon from `pnpm build:daemon` |
| Credit       | 1 MiB per stream (S3b); a client out of credit is resynced, never blocks the program (D-04)                                                                                                      |
| Measurements | p95 by nearest rank; RTT is the median ping-to-pong time over the host's SSH channel, except in the UI echo test, which takes the link's own p95 (P-35)                                          |

## Results

One full run of `pnpm test:nfr`, nothing else running on the machine:

| ID     | Measurement                                                                          | Value      | Target                     |
| ------ | ------------------------------------------------------------------------------------ | ---------- | -------------------------- |
| NFR-02 | trc-ubuntu: SSH round trip, ping to pong over the channel (median)                   | 1.2 ms     | —                          |
| NFR-02 | trc-ubuntu: keystroke to echo at the connection host, p95                            | 4.1 ms     | ≤ 11.2 ms                  |
| NFR-02 | trc-latency: SSH round trip, ping to pong over the channel (median)                  | 105 ms     | —                          |
| NFR-02 | trc-latency: keystroke to echo at the connection host, p95                           | 108 ms     | ≤ 115.1 ms                 |
| NFR-03 | trc-ubuntu: Ctrl+C under `python3` flood until the program reports it, p95           | 5.6 ms     | ≤ 100 ms                   |
| S3b    | trc-ubuntu: output the app received under a 32 MiB flood, 1024 KiB credit window     | 43.7 MiB/s | —                          |
| S3b    | trc-ubuntu: time the program took to write the 32 MiB flood                          | 765 ms     | never blocked (≤ 5,000 ms) |
| S3b    | trc-latency: output the app received under a 32 MiB flood, 1024 KiB credit window    | 2.6 MiB/s  | —                          |
| S3b    | trc-latency: time the program took to write the 32 MiB flood                         | 454 ms     | never blocked (≤ 5,000 ms) |
| NFR-07 | trc-rocky paused: time until the app marks it disconnected                           | 19.9 s     | ≤ 30 s                     |
| NFR-05 | trc-ubuntu: create a session, with up to 100 running, p95                            | 5.1 ms     | —                          |
| NFR-05 | trc-ubuntu: rename to session event, 100 sessions, p95                               | 2.5 ms     | ≤ 250 ms                   |
| NFR-05 | trc-ubuntu: keystroke to echo with 101 sessions, p95                                 | 5.8 ms     | ≤ 11.4 ms                  |
| NFR-05 | 25 hosts: connect and install all at once                                            | 1.7 s      | —                          |
| NFR-05 | 25 hosts: rename to session event, p95                                               | 4.8 ms     | ≤ 250 ms                   |
| NFR-05 | 25 hosts: keystroke to echo, every keystroke on every host, p95                      | 5.4 ms     | ≤ 12.2 ms                  |
| NFR-09 | idle core, no sessions: resident memory                                              | 1.9 MiB    | ≤ 30 MB                    |
| NFR-09 | idle core: CPU over 10 s                                                             | 0.0 %      | ≤ 0.5%                     |
| NFR-09 | per session (largest holder plus the core's growth), 10 idle sessions                | 2.9 MiB    | ≤ 10 MB                    |
| NFR-10 | holder with the default 10,000 lines, full                                           | 14.5 MiB   | bounded                    |
| NFR-10 | holder with the default 10,000 lines: growth after 40000 more lines                  | 0.4 MiB    | ≈ 0                        |
| NFR-10 | holder with the 100,000-line maximum, full                                           | 105 MiB    | bounded                    |
| NFR-10 | holder with the 100,000-line maximum: growth after 300000 more lines                 | 3.2 MiB    | ≈ 0                        |
| SEC-08 | log files holding a typed, printed or environment canary                             | 0.0 files  | 0                          |
| NFR-02 | trc-ubuntu: SSH round trip before the app types, ping to pong over the channel, p95  | 4.3 ms     | —                          |
| NFR-02 | trc-ubuntu: keystroke to its echo parsed in the app, p95                             | 5.8 ms     | ≤ 14.3 ms                  |
| NFR-02 | trc-ubuntu: keystroke to its echo on the text surface (next frame), p95              | 16.8 ms    | next frame                 |
| NFR-02 | trc-latency: SSH round trip before the app types, ping to pong over the channel, p95 | 110 ms     | —                          |
| NFR-02 | trc-latency: keystroke to its echo parsed in the app, p95                            | 111 ms     | ≤ 119.6 ms                 |
| NFR-02 | trc-latency: keystroke to its echo on the text surface (next frame), p95             | 120 ms     | next frame                 |
| NFR-03 | trc-ubuntu: Ctrl+C in the app to SIGINT in the flooding program, p95                 | 30.6 ms    | ≤ 100 ms                   |
| NFR-03 | trc-ubuntu: time between frames while the flood runs, p95                            | 12.7 ms    | ≤ 100 ms                   |
| NFR-04 | trc-ubuntu, screen-reader mode: Return to the announcement of the output, p95        | 127 ms     | ≤ 500 ms                   |
| NFR-06 | interactive window to a restored host reconnecting, worst of 5                       | 7.5 ms     | ≤ 1,000 ms                 |
| NFR-07 | trc-ubuntu: ssh killed to the terminal attached again, worst of 5                    | 826 ms     | ≤ 5,000 ms                 |
| NFR-06 | launch to an interactive window (test build, Playwright included), worst of 5        | 640 ms     | ≤ 2,000 ms                 |

## Soak (NFR-11, S6)

`pnpm test:soak`, one run per scenario, each with 3 sessions on its host (P-25). Every cycle has each session wait
to print a marker, disrupts the host, then tells the sessions to print it; it then checks that each session is
still listed with the same shell PID, shows the marker its old connection never saw, and still runs what is typed.
Connect again is the time from the disruption's new connection starting to the daemon answering, which NFR-07's
reconnect target bounds.

| ID     | Measurement                                                                                                                               | Value  | Target     |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- |
| NFR-11 | app launches on trc-ubuntu: sessions lost in 50 quits and 50 crashes                                                                      | 0.0    | 0          |
| NFR-11 | app quit (ssh connection closed) on trc-alpine: sessions lost in 1000 cycles                                                              | 0.0    | 0          |
| NFR-07 | app quit (ssh connection closed) on trc-alpine: connect again (ssh and daemon check), p95 of 1000                                         | 495 ms | ≤ 5,000 ms |
| NFR-11 | network flap (connection stalled, then a new one) on trc-alpine: sessions lost in 1000 cycles                                             | 0.0    | 0          |
| NFR-07 | network flap (connection stalled, then a new one) on trc-alpine: connect again (ssh and daemon check), p95 of 1000                        | 472 ms | ≤ 5,000 ms |
| NFR-11 | app crash (ssh process killed) on trc-rocky: sessions lost in 1000 cycles                                                                 | 0.0    | 0          |
| NFR-07 | app crash (ssh process killed) on trc-rocky: connect again (ssh and daemon check), p95 of 1000                                            | 520 ms | ≤ 5,000 ms |
| NFR-11 | logout without lingering (KillUserProcesses=no) on trc-systemd: sessions lost in 50 cycles                                                | 0.0    | 0          |
| NFR-07 | logout without lingering (KillUserProcesses=no) on trc-systemd: connect again (ssh and daemon check), p95 of 50                           | 570 ms | ≤ 5,000 ms |
| NFR-11 | daemon kill, detached on trc-ubuntu: sessions lost in 1000 cycles                                                                         | 0.0    | 0          |
| NFR-07 | daemon kill, detached on trc-ubuntu: connect again (ssh and daemon check), p95 of 1000                                                    | 491 ms | ≤ 5,000 ms |
| NFR-11 | daemon upgrade 0.2.0 to this build, detached on trc-ubuntu: sessions lost in 1000 cycles                                                  | 0.0    | 0          |
| NFR-07 | daemon upgrade 0.2.0 to this build, detached on trc-ubuntu: connect again (ssh and daemon check), p95 of 1000                             | 764 ms | ≤ 5,000 ms |
| NFR-11 | daemon upgrade 0.2.0 to this build, under systemd with lingering on trc-systemd-linger: sessions lost in 1000 cycles                      | 0.0    | 0          |
| NFR-07 | daemon upgrade 0.2.0 to this build, under systemd with lingering on trc-systemd-linger: connect again (ssh and daemon check), p95 of 1000 | 936 ms | ≤ 5,000 ms |
| NFR-11 | daemon kill, under systemd with lingering on trc-systemd-linger: sessions lost in 1000 cycles                                             | 0.0    | 0          |
| NFR-07 | daemon kill, under systemd with lingering on trc-systemd-linger: connect again (ssh and daemon check), p95 of 1000                        | 458 ms | ≤ 5,000 ms |

- The app quit and crash cycles close or kill the app's real ssh connection, which is all a quit or a crash does to
  a host; the 50 real launches of each kind restore the session from the last launch (P-25).
- The network flap stalls the app's ssh (`SIGSTOP`) while the daemon still holds the connection, connects again
  and resumes every session from where its output stood: each replay is a delta and shows the marker exactly once
  (US-2.2.2).
- The upgrade cycles start the sessions under the 0.2.0 daemon, so they keep its holders. Each cycle stops the
  core, lets a 0.2.0 core take the sessions, then connects with this build, whose bridge replaces that core under
  `upgrade.lock` (US-2.5.3); only this build's connections are timed. This build's core adopting 0.2.0's holders
  1,000 times on each host also covers NFR-12's previous protocol version.
- The logout scenario runs 50 cycles, not 1,000: each one waits for every login of the user to close and then past
  `UserStopDelaySec` (10 s), and NFR-11 lists no logout scenario. S6's 1,000 cycles of daemon kill and upgrade run
  with lingering (`trc-systemd-linger`) and without (`trc-ubuntu`, where the daemon runs detached as it does on a
  systemd host without lingering).

## Findings

- **NFR-02 on the 100 ms link was measured against the wrong baseline.** The UI test compared the app's p95 with
  the link's median round trip, but the test link jitters by about 5 ms (its own p95 is about 114 to 115 ms against
  a median of 107 to 110 ms), so the app's steady 117 to 118 ms missed by up to 0.5 ms in 3 of 9 runs. The owner
  chose the link's own p95, sampled over another connection just before the typing (P-35): over it the app adds 1
  to 8 ms in four runs, and over the 1 ms link's median about 5 ms, as S13 found. Sampling during the typing was
  tried and dropped, as the test runner's own load added 3 to 5 ms to the pings. Running the test window opaque or
  nearly transparent changed nothing.
- **The detached daemon keeps a logged-out user's login `closing`.** Its processes stay in the login's session
  scope, as tmux's do, so logind never ends the login and systemd keeps the user's manager running (S11). Sessions
  survive either way; the logout soak waits for the `closing` state, then checks that the core still runs outside
  the user manager.
- **S3b's question changed with D-04.** E1 measured throughput under backpressure; in E2 a client that runs out
  of credit is resynced instead, so the 100 ms test now checks that Ctrl+C still arrives promptly and that the
  program is never blocked.
- **Every UI measurement ran in an unseen window** (D-27): click-through, transparent, in the screen's corner and
  never focused, so the tests never take the developer's keyboard.
- **NFR-09 is met at the scrollback maximum too.** Snapshots stream 500 rows at a time within the client's credit
  (S12), so attaching no longer holds a second copy of the session; the PRD's E1 exception is resolved.

## Not measured here

- Speech itself: NFR-04 is measured to the announcement request; the VoiceOver passes in
  `docs/verification/E2-manual-at.md` check that speech follows.
- Network changes and wake (P-34): they retry at once, as `reconnector.test.ts` checks; the soak's flaps stand in
  for the loss itself.

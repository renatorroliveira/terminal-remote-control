# E5 NFR verification and soak (ST-72)

Measured on 2026-11-18 on This computer, the owner's Mac, on the macOS test host (P-71) and on the Linux test
hosts, by `pnpm test:nfr`, the same tests with `TRC_NFR_HOST=local`, and `pnpm test:soak`, on `0b30954`'s daemons
and test build (the review fixes of both rounds included). Conditions are E4's (`E4-nfr.md`): an Apple M3 Pro with
36 GiB on macOS 26.7, the tart VM of macOS 26.6 on lima's user-mode network, the app's test build opened unseen, and
percentiles by nearest rank. Nothing else of ours ran on the machine during the NFR runs.

## What E5 adds

- **NFR-04 for a failed command.** `ui.spec.ts` times Return on `(exit N)` to "Command failed, exit code N.", with
  screen-reader mode on and the shell integration the daemon injected into `trc-ubuntu`'s bash: 409 ms and 20 ms p95
  in the two runs, against 500 ms. The first run's announcement waited behind the speech of the echo's output, as
  P-78 queues it.
- **NFR-05 with integration on.** The scale runs' sessions start the hosts' bash with shell integration, over
  protocol 4, so each prompt is marked; they run no command, so no command event flows, and a session sends at most
  one a second when it does (P-82). 25 hosts' renames still reach the app in 4.5 and 4.8 ms p95, against 250 ms.
- **NFR-09 with command tracking.** The daemon keeps each session's marks (P-74, P-82): the per-session memory of
  10 idle sessions is 3.1 MiB on `trc-ubuntu` and 3.5 MiB on This computer, against 10 MB, as in E4.
- **The renderer's marks (P-82).** With 1,000 marked commands, xterm.js took 341 ms instead of 213 ms to parse
  100,000 flooded lines with a full scrollback, as every marker follows each trimmed line; the app therefore keeps
  300 commands' marks, a third of that cost. `S3b`'s throughput below, measured with integration on, is E4's.

## The test hosts (`pnpm test:nfr`)

| ID     | Measurement                                                                                                                    | Value      | Target                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------- | -------------------------- |
| NFR-02 | trc-ubuntu: SSH round trip, ping to pong over the channel (median)                                                             | 1.2 ms     | —                          |
| NFR-02 | trc-ubuntu: keystroke to echo at the connection host, p99                                                                      | 7.5 ms     | ≤ 17.9 ms                  |
| NFR-02 | trc-latency: SSH round trip, ping to pong over the channel (median)                                                            | 106 ms     | —                          |
| NFR-02 | trc-latency: keystroke to echo at the connection host, p99                                                                     | 115 ms     | ≤ 123.1 ms                 |
| NFR-03 | trc-ubuntu: Ctrl+C under `python3` flood until the program reports it, p95                                                     | 2.6 ms     | ≤ 100 ms                   |
| S3b    | trc-ubuntu: output the app received under a 32 MiB flood, 1024 KiB credit window                                               | 53.6 MiB/s | —                          |
| S3b    | trc-ubuntu: time the program took to write the 32 MiB flood                                                                    | 595 ms     | never blocked (≤ 5,000 ms) |
| S3b    | trc-latency: output the app received under a 32 MiB flood, 1024 KiB credit window                                              | 1.9 MiB/s  | —                          |
| S3b    | trc-latency: time the program took to write the 32 MiB flood                                                                   | 393 ms     | never blocked (≤ 5,000 ms) |
| NFR-07 | trc-rocky paused: time until the app marks it disconnected                                                                     | 19.9 s     | ≤ 30 s                     |
| NFR-09 | trc-ubuntu: idle core, no sessions: resident memory                                                                            | 2.3 MiB    | ≤ 30 MB                    |
| NFR-09 | trc-ubuntu: idle core: CPU over 10 s                                                                                           | 0.0 %      | ≤ 0.5%                     |
| NFR-09 | trc-ubuntu: per session (largest holder plus the core's growth), 10 idle sessions                                              | 3.1 MiB    | ≤ 10 MB                    |
| NFR-10 | holder with the default 10,000 lines, full                                                                                     | 14.7 MiB   | bounded                    |
| NFR-10 | holder with the default 10,000 lines: growth after 40000 more lines                                                            | 0.4 MiB    | ≈ 0                        |
| NFR-10 | holder with the 100,000-line maximum, full                                                                                     | 105 MiB    | bounded                    |
| NFR-10 | holder with the 100,000-line maximum: growth after 300000 more lines                                                           | 3.4 MiB    | ≈ 0                        |
| NFR-09 | holder with the 100,000-line maximum: peak growth while a second client attaches from the start                                | 1.4 MiB    | ≤ 10 MB                    |
| NFR-09 | holder with the 100,000-line maximum, a full-screen program running: peak growth while a second client attaches from the start | 0.0 MiB    | ≤ 10 MB                    |
| NFR-09 | holder with the 100,000-line maximum, a full-screen program running: peak growth while the history follows the program's end   | 1.7 MiB    | ≤ 10 MB                    |
| NFR-09 | holder with the default 10,000 lines, a full-screen program running: peak growth while a second client attaches from the start | 0.0 MiB    | ≤ 10 MB                    |
| NFR-09 | holder with the default 10,000 lines, a full-screen program running: peak growth while the history follows the program's end   | 0.1 MiB    | ≤ 10 MB                    |
| NFR-05 | trc-ubuntu: create a session, with up to 100 running, p95                                                                      | 6.7 ms     | —                          |
| NFR-05 | trc-ubuntu: rename to session event, 100 sessions, p95                                                                         | 1.2 ms     | ≤ 250 ms                   |
| NFR-05 | trc-ubuntu: keystroke to echo with 101 sessions, p99                                                                           | 6.4 ms     | ≤ 17.6 ms                  |
| NFR-05 | 25 hosts: connect and install all at once                                                                                      | 1.5 s      | —                          |
| NFR-05 | 25 hosts: rename to session event, p95                                                                                         | 4.8 ms     | ≤ 250 ms                   |
| NFR-05 | 25 hosts: keystroke to echo, every keystroke on every host, p99                                                                | 6.8 ms     | ≤ 18.5 ms                  |
| NFR-08 | trc-ubuntu: output to its fdatasync'ed copy on disk, largest of 40 markers over a 1.2 MB flood                                 | 2.0 s      | ≤ 5 s                      |
| NFR-05 | trc-ubuntu: connected after a host restart to all 100 sessions restored and running                                            | 0.3 s      | —                          |
| NFR-05 | trc-ubuntu: host restart to all 100 sessions restored and running                                                              | 0.6 s      | —                          |
| SEC-08 | log files holding a typed, printed or environment canary                                                                       | 0.0 files  | 0                          |
| NFR-02 | trc-ubuntu: SSH round trip before the app types, ping to pong over the channel, p50                                            | 2.3 ms     | —                          |
| NFR-02 | trc-ubuntu: SSH round trip before the app types, ping to pong over the channel, p95                                            | 4.6 ms     | —                          |
| NFR-02 | trc-ubuntu: SSH round trip before the app types, ping to pong over the channel, p99                                            | 5.1 ms     | —                          |
| NFR-02 | trc-ubuntu: keystroke to its echo parsed in the app, p99                                                                       | 9.4 ms     | ≤ 21.2 ms                  |
| NFR-02 | trc-ubuntu: keystroke to its echo on the text surface (next frame), p99                                                        | 18.9 ms    | next frame                 |
| NFR-02 | trc-latency: SSH round trip before the app types, ping to pong over the channel, p50                                           | 109 ms     | —                          |
| NFR-02 | trc-latency: SSH round trip before the app types, ping to pong over the channel, p95                                           | 114 ms     | —                          |
| NFR-02 | trc-latency: SSH round trip before the app types, ping to pong over the channel, p99                                           | 115 ms     | —                          |
| NFR-02 | trc-latency: keystroke to its echo parsed in the app, p99                                                                      | 115 ms     | ≤ 131.1 ms                 |
| NFR-02 | trc-latency: keystroke to its echo on the text surface (next frame), p99                                                       | 127 ms     | next frame                 |
| NFR-01 | This computer: keystroke to its echo parsed in the app, p50                                                                    | 1.3 ms     | —                          |
| NFR-01 | This computer: keystroke to its echo parsed in the app, p95                                                                    | 2.1 ms     | —                          |
| NFR-01 | This computer: keystroke to its echo parsed in the app, p99                                                                    | 4.8 ms     | ≤ 16.7 ms                  |
| NFR-01 | This computer: keystroke to its echo on the text surface (next frame), p99                                                     | 14.7 ms    | next frame                 |
| NFR-03 | trc-ubuntu: Ctrl+C in the app to SIGINT in the flooding program, p95                                                           | 26.2 ms    | ≤ 100 ms                   |
| NFR-03 | trc-ubuntu: time between frames while the flood runs, p95                                                                      | 13.5 ms    | ≤ 100 ms                   |
| NFR-04 | trc-ubuntu, screen-reader mode: Return to the announcement of the output, p95                                                  | 404 ms     | ≤ 500 ms                   |
| NFR-04 | trc-ubuntu, shell integration: Return on a failing command to its announcement, p95                                            | 409 ms     | ≤ 500 ms                   |
| NFR-06 | interactive window to a restored host reconnecting, worst of 5                                                                 | 5.8 ms     | ≤ 1,000 ms                 |
| NFR-07 | trc-ubuntu: ssh killed to the terminal attached again, worst of 5                                                              | 341 ms     | ≤ 5,000 ms                 |
| NFR-06 | launch to an interactive window (test build, Playwright included), worst of 5                                                  | 476 ms     | ≤ 2,000 ms                 |

## This computer (`TRC_NFR_HOST=local pnpm test:nfr`)

| ID     | Measurement                                                                                                                    | Value      | Target                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------- | -------------------------- |
| NFR-02 | trc-ubuntu: SSH round trip, ping to pong over the channel (median)                                                             | 0.8 ms     | —                          |
| NFR-02 | trc-ubuntu: keystroke to echo at the connection host, p99                                                                      | 5.7 ms     | ≤ 17.4 ms                  |
| NFR-02 | trc-latency: SSH round trip, ping to pong over the channel (median)                                                            | 110 ms     | —                          |
| NFR-02 | trc-latency: keystroke to echo at the connection host, p99                                                                     | 113 ms     | ≤ 126.8 ms                 |
| NFR-03 | trc-ubuntu: Ctrl+C under `python3` flood until the program reports it, p95                                                     | 27.5 ms    | ≤ 100 ms                   |
| S3b    | trc-ubuntu: output the app received under a 32 MiB flood, 1024 KiB credit window                                               | 60.7 MiB/s | —                          |
| S3b    | trc-ubuntu: time the program took to write the 32 MiB flood                                                                    | 549 ms     | never blocked (≤ 5,000 ms) |
| S3b    | trc-latency: output the app received under a 32 MiB flood, 1024 KiB credit window                                              | 1.9 MiB/s  | —                          |
| S3b    | trc-latency: time the program took to write the 32 MiB flood                                                                   | 367 ms     | never blocked (≤ 5,000 ms) |
| NFR-07 | trc-rocky paused: time until the app marks it disconnected                                                                     | 19.9 s     | ≤ 30 s                     |
| NFR-09 | local: idle core, no sessions: resident memory                                                                                 | 3.0 MiB    | ≤ 30 MB                    |
| NFR-09 | local: idle core: CPU over 10 s                                                                                                | 0.0 %      | ≤ 0.5%                     |
| NFR-09 | local: per session (largest holder plus the core's growth), 10 idle sessions                                                   | 3.5 MiB    | ≤ 10 MB                    |
| NFR-10 | holder with the default 10,000 lines, full                                                                                     | 14.7 MiB   | bounded                    |
| NFR-10 | holder with the default 10,000 lines: growth after 40000 more lines                                                            | 0.4 MiB    | ≈ 0                        |
| NFR-10 | holder with the 100,000-line maximum, full                                                                                     | 105 MiB    | bounded                    |
| NFR-10 | holder with the 100,000-line maximum: growth after 300000 more lines                                                           | 3.5 MiB    | ≈ 0                        |
| NFR-09 | holder with the 100,000-line maximum: peak growth while a second client attaches from the start                                | 1.6 MiB    | ≤ 10 MB                    |
| NFR-09 | holder with the 100,000-line maximum, a full-screen program running: peak growth while a second client attaches from the start | 0.0 MiB    | ≤ 10 MB                    |
| NFR-09 | holder with the 100,000-line maximum, a full-screen program running: peak growth while the history follows the program's end   | 1.3 MiB    | ≤ 10 MB                    |
| NFR-09 | holder with the default 10,000 lines, a full-screen program running: peak growth while a second client attaches from the start | 0.0 MiB    | ≤ 10 MB                    |
| NFR-09 | holder with the default 10,000 lines, a full-screen program running: peak growth while the history follows the program's end   | 0.1 MiB    | ≤ 10 MB                    |
| NFR-05 | local: create a session, with up to 100 running, p95                                                                           | 13.5 ms    | —                          |
| NFR-05 | local: rename to session event, 100 sessions, p95                                                                              | 0.6 ms     | ≤ 250 ms                   |
| NFR-05 | local: keystroke to echo with 101 sessions, p99                                                                                | 0.9 ms     | ≤ 17.0 ms                  |
| NFR-05 | 25 hosts: connect and install all at once                                                                                      | 1.6 s      | —                          |
| NFR-05 | 25 hosts: rename to session event, p95                                                                                         | 4.5 ms     | ≤ 250 ms                   |
| NFR-05 | 25 hosts: keystroke to echo, every keystroke on every host, p99                                                                | 6.6 ms     | ≤ 18.5 ms                  |
| NFR-08 | trc-ubuntu: output to its fdatasync'ed copy on disk, largest of 40 markers over a 1.2 MB flood                                 | 2.1 s      | ≤ 5 s                      |
| NFR-05 | trc-ubuntu: connected after a host restart to all 100 sessions restored and running                                            | 0.3 s      | —                          |
| NFR-05 | trc-ubuntu: host restart to all 100 sessions restored and running                                                              | 0.7 s      | —                          |
| SEC-08 | log files holding a typed, printed or environment canary                                                                       | 0.0 files  | 0                          |
| NFR-02 | trc-ubuntu: SSH round trip before the app types, ping to pong over the channel, p50                                            | 2.6 ms     | —                          |
| NFR-02 | trc-ubuntu: SSH round trip before the app types, ping to pong over the channel, p95                                            | 4.9 ms     | —                          |
| NFR-02 | trc-ubuntu: SSH round trip before the app types, ping to pong over the channel, p99                                            | 11.4 ms    | —                          |
| NFR-02 | trc-ubuntu: keystroke to its echo parsed in the app, p99                                                                       | 5.7 ms     | ≤ 21.6 ms                  |
| NFR-02 | trc-ubuntu: keystroke to its echo on the text surface (next frame), p99                                                        | 18.6 ms    | next frame                 |
| NFR-02 | trc-latency: SSH round trip before the app types, ping to pong over the channel, p50                                           | 108 ms     | —                          |
| NFR-02 | trc-latency: SSH round trip before the app types, ping to pong over the channel, p95                                           | 113 ms     | —                          |
| NFR-02 | trc-latency: SSH round trip before the app types, ping to pong over the channel, p99                                           | 114 ms     | —                          |
| NFR-02 | trc-latency: keystroke to its echo parsed in the app, p99                                                                      | 116 ms     | ≤ 129.2 ms                 |
| NFR-02 | trc-latency: keystroke to its echo on the text surface (next frame), p99                                                       | 126 ms     | next frame                 |
| NFR-01 | This computer: keystroke to its echo parsed in the app, p50                                                                    | 1.3 ms     | —                          |
| NFR-01 | This computer: keystroke to its echo parsed in the app, p95                                                                    | 1.9 ms     | —                          |
| NFR-01 | This computer: keystroke to its echo parsed in the app, p99                                                                    | 2.5 ms     | ≤ 16.7 ms                  |
| NFR-01 | This computer: keystroke to its echo on the text surface (next frame), p99                                                     | 13.9 ms    | next frame                 |
| NFR-03 | trc-ubuntu: Ctrl+C in the app to SIGINT in the flooding program, p95                                                           | 8.0 ms     | ≤ 100 ms                   |
| NFR-03 | trc-ubuntu: time between frames while the flood runs, p95                                                                      | 13.5 ms    | ≤ 100 ms                   |
| NFR-04 | trc-ubuntu, screen-reader mode: Return to the announcement of the output, p95                                                  | 414 ms     | ≤ 500 ms                   |
| NFR-04 | trc-ubuntu, shell integration: Return on a failing command to its announcement, p95                                            | 20.0 ms    | ≤ 500 ms                   |
| NFR-06 | interactive window to a restored host reconnecting, worst of 5                                                                 | 6.7 ms     | ≤ 1,000 ms                 |
| NFR-07 | trc-ubuntu: ssh killed to the terminal attached again, worst of 5                                                              | 348 ms     | ≤ 5,000 ms                 |
| NFR-06 | launch to an interactive window (test build, Playwright included), worst of 5                                                  | 539 ms     | ≤ 2,000 ms                 |

## Soak (NFR-11)

`pnpm test:soak` ran on the same build (`0b30954`'s daemon and test build) from 11:27 to 19:24 UTC on 2026-11-18,
with shell integration on, its default, in every bash session. Its scenarios ran one after another, each with 3
sessions on its host: the Linux scenarios of E2 and E3, the 100 host restarts, `launchd.soak.test.ts` on This
computer (a temporary LaunchAgent, P-58) and on `trc-mac-gui`, and the app launches on a Linux host and on This
computer. Every scenario lost no session, and no session was restored twice.

| ID     | Measurement                                                                                                                               | Value    | Target     |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- |
| NFR-11 | logout without lingering (KillUserProcesses=no) on trc-systemd: sessions lost in 1000 cycles                                              | 0.0      | 0          |
| NFR-07 | logout without lingering (KillUserProcesses=no) on trc-systemd: connect again (ssh and daemon check), p95 of 1000                         | 430 ms   | ≤ 5,000 ms |
| NFR-11 | daemon kill, detached on trc-ubuntu: sessions lost in 1000 cycles                                                                         | 0.0      | 0          |
| NFR-07 | daemon kill, detached on trc-ubuntu: connect again (ssh and daemon check), p95 of 1000                                                    | 444 ms   | ≤ 5,000 ms |
| NFR-11 | daemon kill, under systemd with lingering on trc-systemd-linger: sessions lost in 1000 cycles                                             | 0.0      | 0          |
| NFR-07 | daemon kill, under systemd with lingering on trc-systemd-linger: connect again (ssh and daemon check), p95 of 1000                        | 501 ms   | ≤ 5,000 ms |
| NFR-11 | daemon upgrade 0.2.0 to this build, detached on trc-ubuntu: sessions lost in 1000 cycles                                                  | 0.0      | 0          |
| NFR-07 | daemon upgrade 0.2.0 to this build, detached on trc-ubuntu: connect again (ssh and daemon check), p95 of 1000                             | 909 ms   | ≤ 5,000 ms |
| NFR-11 | daemon upgrade 0.2.0 to this build, under systemd with lingering on trc-systemd-linger: sessions lost in 1000 cycles                      | 0.0      | 0          |
| NFR-07 | daemon upgrade 0.2.0 to this build, under systemd with lingering on trc-systemd-linger: connect again (ssh and daemon check), p95 of 1000 | 1,036 ms | ≤ 5,000 ms |
| NFR-11 | daemon kill, LaunchAgent on local: sessions lost in 1000 cycles                                                                           | 0.0      | 0          |
| NFR-07 | daemon kill, LaunchAgent on local: connect again (ssh and daemon check), p95 of 1000                                                      | 1,077 ms | ≤ 5,000 ms |
| NFR-11 | daemon kill, LaunchAgent on trc-mac-gui: sessions lost in 1000 cycles                                                                     | 0.0      | 0          |
| NFR-07 | daemon kill, LaunchAgent on trc-mac-gui: connect again (ssh and daemon check), p95 of 1000                                                | 948 ms   | ≤ 5,000 ms |
| NFR-11 | daemon upgrade, LaunchAgent on local: sessions lost in 1000 cycles                                                                        | 0.0      | 0          |
| NFR-07 | daemon upgrade, LaunchAgent on local: connect again (ssh and daemon check), p95 of 1000                                                   | 423 ms   | ≤ 5,000 ms |
| NFR-11 | daemon upgrade, LaunchAgent on trc-mac-gui: sessions lost in 1000 cycles                                                                  | 0.0      | 0          |
| NFR-07 | daemon upgrade, LaunchAgent on trc-mac-gui: connect again (ssh and daemon check), p95 of 1000                                             | 445 ms   | ≤ 5,000 ms |
| US-3.1 | trc-ubuntu: sessions lost or restored twice in 100 restarts                                                                               | 0.0      | 0          |
| US-3.1 | trc-ubuntu: host restart to every session restored and taking input, p95 of 100                                                           | 1.1 s    | —          |
| NFR-11 | app quit (ssh connection closed) on trc-alpine: sessions lost in 1000 cycles                                                              | 0.0      | 0          |
| NFR-07 | app quit (ssh connection closed) on trc-alpine: connect again (ssh and daemon check), p95 of 1000                                         | 473 ms   | ≤ 5,000 ms |
| NFR-11 | app crash (ssh process killed) on trc-rocky: sessions lost in 1000 cycles                                                                 | 0.0      | 0          |
| NFR-07 | app crash (ssh process killed) on trc-rocky: connect again (ssh and daemon check), p95 of 1000                                            | 556 ms   | ≤ 5,000 ms |
| NFR-11 | network flap (connection stalled, then a new one) on trc-alpine: sessions lost in 1000 cycles                                             | 0.0      | 0          |
| NFR-07 | network flap (connection stalled, then a new one) on trc-alpine: connect again (ssh and daemon check), p95 of 1000                        | 418 ms   | ≤ 5,000 ms |
| NFR-11 | app launches on trc-ubuntu: sessions lost in 50 quits and 50 crashes                                                                      | 0.0      | 0          |
| NFR-11 | app launches on This computer: sessions lost in 50 quits and 50 crashes                                                                   | 0.0      | 0          |

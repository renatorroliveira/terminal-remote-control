# E6 NFR verification and soak, part 1 (ST-83)

Measured on 2026-11-22 UTC from Windows 11 Pro (build 26300) on a 12th Gen Intel Core i9-12900K with 32 GiB, against
the Linux test hosts in Docker Desktop 29.2.1's WSL 2 engine, by `pnpm test:nfr` on the tree committed as `a8e0098`
(its test build and daemon bundle). The app's test build opened unseen, and percentiles are by nearest rank. Apart
from one type check of about a minute, nothing else of ours ran on the machine during the run. This computer has no
measurements here: it arrives on Windows in 0.8.0 (P-85).

## What part 1 measures from Windows

- **What changes.** Part 1 is the Windows app against remote hosts: the renderer, the connection host and Windows
  OpenSSH's `ssh.exe` are new to the path; the hosts' daemons are E5's, with only Windows-only helpers added. The
  daemon-side rows (NFR-08, NFR-09, NFR-10) are measured again and stay within their targets, as in E5.
- **The first run, and its fixes.** The first `pnpm test:nfr` on Windows found three test bugs, fixed in `a8e0098`:
  the script's `;`, which cmd.exe passed to vitest; the docker calls naming colima's context; and the restore test
  restarting the host before the core had synced every session record, which Docker Desktop's slower disk exposed.
  The same run measured NFR-03's flood interrupt at 166 ms p95 while other work of ours ran beside it; run alone it
  passed, and the run below measured 84.3 ms.
- **NFR-05's echo at scale misses P-35's budget on Windows.** With 101 sessions on `trc-ubuntu` the echo p99 was
  22.7 ms against 18.4 ms, and across 25 hosts 26.7 ms against 17.9 ms; an earlier run passed both. P-35 sets the
  budget from the median round trip, and Windows' round trip has a long tail of its own: plain `ssh.exe` to the same
  container, with no TRC in the path, echoed 500 lines at 1.5 ms p50 and 15.0 to 22.1 ms p99 in two runs, and this
  run's UI test sampled the link at 2.1 ms p50, 4.9 ms p95 and 31.8 ms p99. The median baseline therefore counts the
  link's tail as the app's. The single-host check meets the same rule, narrowly: 16.1 ms against 18.0 ms here, and
  17.2 and 17.8 ms against 17.8 ms in earlier runs. **Open:** P-35 is the owner's decision; the proposal is to
  compare with the round trip's own p99 on Windows (P-105). Until it is decided, these two rows are not met.
- **NFR-04** was measured with screen-reader mode on and no screen reader running; the run with Narrator on (P-97)
  waits for the owner.

## The test hosts (`pnpm test:nfr`)

| ID     | Measurement                                                                                                                    | Value      | Target                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------- | -------------------------- |
| NFR-02 | trc-ubuntu: SSH round trip, ping to pong over the channel (median)                                                             | 1.4 ms     | —                          |
| NFR-02 | trc-ubuntu: keystroke to echo at the connection host, p99                                                                      | 16.1 ms    | ≤ 18.0 ms                  |
| NFR-02 | trc-latency: SSH round trip, ping to pong over the channel (median)                                                            | 102 ms     | —                          |
| NFR-02 | trc-latency: keystroke to echo at the connection host, p99                                                                     | 114 ms     | ≤ 118.7 ms                 |
| NFR-03 | trc-ubuntu: Ctrl+C under `python3` flood until the program reports it, p95                                                     | 84.3 ms    | ≤ 100 ms                   |
| S3b    | trc-ubuntu: output the app received under a 32 MiB flood, 1024 KiB credit window                                               | 31.3 MiB/s | —                          |
| S3b    | trc-ubuntu: time the program took to write the 32 MiB flood                                                                    | 862 ms     | never blocked (≤ 5,000 ms) |
| S3b    | trc-latency: output the app received under a 32 MiB flood, 1024 KiB credit window                                              | 3.9 MiB/s  | —                          |
| S3b    | trc-latency: time the program took to write the 32 MiB flood                                                                   | 868 ms     | never blocked (≤ 5,000 ms) |
| NFR-07 | trc-rocky paused: time until the app marks it disconnected                                                                     | 19.9 s     | ≤ 30 s                     |
| NFR-05 | trc-ubuntu: create a session, with up to 100 running, p95                                                                      | 6.0 ms     | —                          |
| NFR-05 | trc-ubuntu: rename to session event, 100 sessions, p95                                                                         | 1.1 ms     | ≤ 250 ms                   |
| NFR-05 | trc-ubuntu: keystroke to echo with 101 sessions, p99                                                                           | 22.7 ms    | ≤ 18.4 ms                  |
| NFR-05 | 25 hosts: connect and install all at once                                                                                      | 3.3 s      | —                          |
| NFR-05 | 25 hosts: rename to session event, p95                                                                                         | 2.0 ms     | ≤ 250 ms                   |
| NFR-05 | 25 hosts: keystroke to echo, every keystroke on every host, p99                                                                | 26.7 ms    | ≤ 17.9 ms                  |
| NFR-09 | trc-ubuntu: idle core, no sessions: resident memory                                                                            | 2.5 MiB    | ≤ 30 MB                    |
| NFR-09 | trc-ubuntu: idle core: CPU over 10 s                                                                                           | 0.0 %      | ≤ 0.5%                     |
| NFR-09 | trc-ubuntu: per session (largest holder plus the core's growth), 10 idle sessions                                              | 3.8 MiB    | ≤ 10 MB                    |
| NFR-10 | holder with the default 10,000 lines, full                                                                                     | 15.4 MiB   | bounded                    |
| NFR-10 | holder with the default 10,000 lines: growth after 40000 more lines                                                            | 0.5 MiB    | ≈ 0                        |
| NFR-10 | holder with the 100,000-line maximum, full                                                                                     | 106 MiB    | bounded                    |
| NFR-10 | holder with the 100,000-line maximum: growth after 300000 more lines                                                           | 3.9 MiB    | ≈ 0                        |
| NFR-09 | holder with the 100,000-line maximum: peak growth while a second client attaches from the start                                | 1.1 MiB    | ≤ 10 MB                    |
| NFR-09 | holder with the 100,000-line maximum, a full-screen program running: peak growth while a second client attaches from the start | 0.0 MiB    | ≤ 10 MB                    |
| NFR-09 | holder with the 100,000-line maximum, a full-screen program running: peak growth while the history follows the program's end   | 1.4 MiB    | ≤ 10 MB                    |
| NFR-09 | holder with the default 10,000 lines, a full-screen program running: peak growth while a second client attaches from the start | 0.0 MiB    | ≤ 10 MB                    |
| NFR-09 | holder with the default 10,000 lines, a full-screen program running: peak growth while the history follows the program's end   | 0.1 MiB    | ≤ 10 MB                    |
| NFR-08 | trc-ubuntu: output to its fdatasync'ed copy on disk, largest of 40 markers over a 1.2 MB flood                                 | 2.0 s      | ≤ 5 s                      |
| NFR-05 | trc-ubuntu: connected after a host restart to all 100 sessions restored and running                                            | 0.3 s      | —                          |
| NFR-05 | trc-ubuntu: host restart to all 100 sessions restored and running                                                              | 0.7 s      | —                          |
| SEC-08 | log files holding a typed, printed or environment canary                                                                       | 0.0 files  | 0                          |
| NFR-02 | trc-ubuntu: SSH round trip before the app types, ping to pong over the channel, p50                                            | 2.1 ms     | —                          |
| NFR-02 | trc-ubuntu: SSH round trip before the app types, ping to pong over the channel, p95                                            | 4.9 ms     | —                          |
| NFR-02 | trc-ubuntu: SSH round trip before the app types, ping to pong over the channel, p99                                            | 31.8 ms    | —                          |
| NFR-02 | trc-ubuntu: keystroke to its echo parsed in the app, p99                                                                       | 19.3 ms    | ≤ 21.6 ms                  |
| NFR-02 | trc-ubuntu: keystroke to its echo on the text surface (next frame), p99                                                        | 25.9 ms    | next frame                 |
| NFR-02 | trc-latency: SSH round trip before the app types, ping to pong over the channel, p50                                           | 102 ms     | —                          |
| NFR-02 | trc-latency: SSH round trip before the app types, ping to pong over the channel, p95                                           | 106 ms     | —                          |
| NFR-02 | trc-latency: SSH round trip before the app types, ping to pong over the channel, p99                                           | 124 ms     | —                          |
| NFR-02 | trc-latency: keystroke to its echo parsed in the app, p99                                                                      | 122 ms     | ≤ 122.3 ms                 |
| NFR-02 | trc-latency: keystroke to its echo on the text surface (next frame), p99                                                       | 122 ms     | next frame                 |
| NFR-03 | trc-ubuntu: Ctrl+C in the app to SIGINT in the flooding program, p95                                                           | 15.9 ms    | ≤ 100 ms                   |
| NFR-03 | trc-ubuntu: time between frames while the flood runs, p95                                                                      | 13.9 ms    | ≤ 100 ms                   |
| NFR-04 | trc-ubuntu, screen-reader mode: Return to the announcement of the output, p95                                                  | 139 ms     | ≤ 500 ms                   |
| NFR-04 | trc-ubuntu, shell integration: Return on a failing command to its announcement, p95                                            | 30.2 ms    | ≤ 500 ms                   |
| NFR-06 | interactive window to a restored host reconnecting, worst of 5                                                                 | 5.5 ms     | ≤ 1,000 ms                 |
| NFR-07 | trc-ubuntu: ssh killed to the terminal attached again, worst of 5                                                              | 1,021 ms   | ≤ 5,000 ms                 |
| NFR-06 | launch to an interactive window (test build, Playwright included), worst of 5                                                  | 683 ms     | ≤ 2,000 ms                 |

## Soak (NFR-11)

From the same machine on 2026-11-26 UTC, on `6231541`'s test build: the app soak (`app.spec.ts`, 50 launches ending
in a quit and 50 in a crash, each with a session on `trc-ubuntu`), then `ssh.soak.test.ts`, whose quits close the
connection and whose crashes kill Windows' `ssh.exe` with `TerminateProcess`, 1,000 cycles each. No session was lost
and none restored twice. The flap soak needs to stop and continue `ssh`, which Windows can't do to a process, so it
stays macOS's; the daemon, logout and reboot soaks change nothing on the host side in part 1 and keep E5's results.

| ID     | Measurement                                                                                       | Value  | Target     |
| ------ | ------------------------------------------------------------------------------------------------- | ------ | ---------- |
| NFR-11 | app launches on trc-ubuntu: sessions lost in 50 quits and 50 crashes                              | 0      | 0          |
| NFR-11 | app quit (ssh connection closed) on trc-alpine: sessions lost in 1000 cycles                      | 0      | 0          |
| NFR-07 | app quit (ssh connection closed) on trc-alpine: connect again (ssh and daemon check), p95 of 1000 | 238 ms | ≤ 5,000 ms |
| NFR-11 | app crash (ssh process killed) on trc-rocky: sessions lost in 1000 cycles                         | 0      | 0          |
| NFR-07 | app crash (ssh process killed) on trc-rocky: connect again (ssh and daemon check), p95 of 1000    | 300 ms | ≤ 5,000 ms |

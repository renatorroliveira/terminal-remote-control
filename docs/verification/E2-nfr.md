# E2 NFR verification and soak (ST-36)

Measured on 2026-11-15 and 2026-11-16 by `pnpm test:nfr` and `pnpm test:soak` against the test hosts
(`tools/test-hosts`, P-04). `node tools/nfr-report/nfr-report.ts` prints each run's table from
`apps/desktop/nfr-results/results.jsonl`. E1's results (`E1-nfr.md`) still describe what E2 did not change.

## Conditions

| Item         | Value                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Client       | Apple M3 Pro, 36 GiB, macOS 26.7.3, display at 100 Hz, OpenSSH 10.5p1                                                                                                                            |
| Test hosts   | colima profile `trc`: aarch64 VM, 4 CPUs, 6 GiB, Docker; Ubuntu 24.04, Rocky 9 and Alpine; `trc-systemd` (lingering off) and `trc-systemd-linger` (P-32)                                         |
| Network      | `127.0.0.1` port forwards into the VM; `trc-latency` adds 100 ms with `tc netem` (egress)                                                                                                        |
| Builds       | The app's test build (P-14), opened unseen in the screen's corner (D-27), for the UI half and the app-launch soak; the connection host in Node for the rest; the daemon from `pnpm build:daemon` |
| Credit       | 1 MiB per stream (S3b); a client out of credit is resynced, never blocks the program (D-04)                                                                                                      |
| Measurements | Percentiles by nearest rank; NFR-02 at p99 over exactly 200 keystrokes (P-36); its round trip is the median ping over the host's SSH channel, or the link's own p95 in the UI test (P-35)        |
| Memory       | MiB; the tests hold NFR-09's "MB" targets as MiB                                                                                                                                                 |

## Results

One full run of `pnpm test:nfr` on the release candidate, nothing else running on the machine:

| ID     | Measurement                                                                                                                    | Value      | Target                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------- | -------------------------- |
| NFR-02 | trc-ubuntu: SSH round trip, ping to pong over the channel (median)                                                             | 0.9 ms     | —                          |
| NFR-02 | trc-ubuntu: keystroke to echo at the connection host, p99                                                                      | 11.2 ms    | ≤ 17.6 ms                  |
| NFR-02 | trc-latency: SSH round trip, ping to pong over the channel (median)                                                            | 106 ms     | —                          |
| NFR-02 | trc-latency: keystroke to echo at the connection host, p99                                                                     | 112 ms     | ≤ 123.0 ms                 |
| NFR-03 | trc-ubuntu: Ctrl+C under `python3` flood until the program reports it, p95                                                     | 5.4 ms     | ≤ 100 ms                   |
| S3b    | trc-ubuntu: output the app received under a 32 MiB flood, 1024 KiB credit window                                               | 46.7 MiB/s | —                          |
| S3b    | trc-ubuntu: time the program took to write the 32 MiB flood                                                                    | 718 ms     | never blocked (≤ 5,000 ms) |
| S3b    | trc-latency: output the app received under a 32 MiB flood, 1024 KiB credit window                                              | 2.5 MiB/s  | —                          |
| S3b    | trc-latency: time the program took to write the 32 MiB flood                                                                   | 470 ms     | never blocked (≤ 5,000 ms) |
| NFR-07 | trc-rocky paused: time until the app marks it disconnected                                                                     | 19.9 s     | ≤ 30 s                     |
| NFR-05 | trc-ubuntu: create a session, with up to 100 running, p95                                                                      | 3.7 ms     | —                          |
| NFR-05 | trc-ubuntu: rename to session event, 100 sessions, p95                                                                         | 1.9 ms     | ≤ 250 ms                   |
| NFR-05 | trc-ubuntu: keystroke to echo with 101 sessions, p99                                                                           | 8.6 ms     | ≤ 18.0 ms                  |
| NFR-05 | 25 hosts: connect and install all at once                                                                                      | 1.6 s      | —                          |
| NFR-05 | 25 hosts: rename to session event, p95                                                                                         | 6.9 ms     | ≤ 250 ms                   |
| NFR-05 | 25 hosts: keystroke to echo, every keystroke on every host, p99                                                                | 11.0 ms    | ≤ 19.5 ms                  |
| NFR-09 | idle core, no sessions: resident memory                                                                                        | 1.9 MiB    | ≤ 30 MB                    |
| NFR-09 | idle core: CPU over 10 s                                                                                                       | 0.0 %      | ≤ 0.5%                     |
| NFR-09 | per session (largest holder plus the core's growth), 10 idle sessions                                                          | 2.9 MiB    | ≤ 10 MB                    |
| NFR-10 | holder with the default 10,000 lines, full                                                                                     | 14.4 MiB   | bounded                    |
| NFR-10 | holder with the default 10,000 lines: growth after 40000 more lines                                                            | 0.5 MiB    | ≈ 0                        |
| NFR-10 | holder with the 100,000-line maximum, full                                                                                     | 105 MiB    | bounded                    |
| NFR-10 | holder with the 100,000-line maximum: growth after 300000 more lines                                                           | 3.3 MiB    | ≈ 0                        |
| NFR-09 | holder with the 100,000-line maximum: peak growth while a second client attaches from the start                                | 1.6 MiB    | ≤ 10 MB                    |
| NFR-09 | holder with the 100,000-line maximum, a full-screen program running: peak growth while a second client attaches from the start | 95.3 MiB   | ≤ 10 MB                    |
| NFR-09 | holder with the default 10,000 lines, a full-screen program running: peak growth while a second client attaches from the start | 9.9 MiB    | ≤ 10 MB                    |
| SEC-08 | log files holding a typed, printed or environment canary                                                                       | 0.0 files  | 0                          |
| NFR-02 | trc-ubuntu: SSH round trip before the app types, ping to pong over the channel, p50                                            | 3.3 ms     | —                          |
| NFR-02 | trc-ubuntu: SSH round trip before the app types, ping to pong over the channel, p95                                            | 5.4 ms     | —                          |
| NFR-02 | trc-ubuntu: SSH round trip before the app types, ping to pong over the channel, p99                                            | 6.2 ms     | —                          |
| NFR-02 | trc-ubuntu: keystroke to its echo parsed in the app, p99                                                                       | 9.4 ms     | ≤ 22.1 ms                  |
| NFR-02 | trc-ubuntu: keystroke to its echo on the text surface (next frame), p99                                                        | 19.2 ms    | next frame                 |
| NFR-02 | trc-latency: SSH round trip before the app types, ping to pong over the channel, p50                                           | 108 ms     | —                          |
| NFR-02 | trc-latency: SSH round trip before the app types, ping to pong over the channel, p95                                           | 111 ms     | —                          |
| NFR-02 | trc-latency: SSH round trip before the app types, ping to pong over the channel, p99                                           | 112 ms     | —                          |
| NFR-02 | trc-latency: keystroke to its echo parsed in the app, p99                                                                      | 117 ms     | ≤ 127.4 ms                 |
| NFR-02 | trc-latency: keystroke to its echo on the text surface (next frame), p99                                                       | 123 ms     | next frame                 |
| NFR-03 | trc-ubuntu: Ctrl+C in the app to SIGINT in the flooding program, p95                                                           | 9.8 ms     | ≤ 100 ms                   |
| NFR-03 | trc-ubuntu: time between frames while the flood runs, p95                                                                      | 10.9 ms    | ≤ 100 ms                   |
| NFR-04 | trc-ubuntu, screen-reader mode: Return to the announcement of the output, p95                                                  | 121 ms     | ≤ 500 ms                   |
| NFR-06 | interactive window to a restored host reconnecting, worst of 5                                                                 | 5.8 ms     | ≤ 1,000 ms                 |
| NFR-07 | trc-ubuntu: ssh killed to the terminal attached again, worst of 5                                                              | 369 ms     | ≤ 5,000 ms                 |
| NFR-06 | launch to an interactive window (test build, Playwright included), worst of 5                                                  | 582 ms     | ≤ 2,000 ms                 |

The NFR-09 rows for a full-screen program are the E2 exception (P-37): the 100,000-line row is far over the target,
and the default row is at it (9.9 MiB, 10.3 MB). Each stays within one copy of the holder, which the test asserts.

## Soak (NFR-11, S6)

`pnpm test:soak`'s scenarios, each with 3 sessions on its host (P-25). Every cycle has each session wait to print a
marker, disrupts the host, then tells the sessions to print it; it then checks that each session is still listed
with the same shell PID, shows the marker its old connection never saw, and still runs what is typed. Connect again
is the time from the disruption's new connection starting to the daemon answering, which NFR-07's reconnect target
bounds.

Each scenario ran as its own `vitest run` or Playwright run. The eight 1,000-cycle and app-launch scenarios ran at the
same time on 2026-11-15, each on its own host in the one VM, so their connect-again times were measured under that
load; they took 40 minutes. The 1,000-cycle logout scenario then ran alone, for 3.6 hours. They ran on a local build
of the daemon before round 6's type-only change to how the bridge passes the umask, and on the soak harness as
committed, apart from round 5's type-only changes to `soak.ts` (a private field and a narrowing guard).

| ID     | Measurement                                                                                                                               | Value  | Target     |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- |
| NFR-11 | app launches on trc-ubuntu: sessions lost in 50 quits and 50 crashes                                                                      | 0.0    | 0          |
| NFR-11 | app quit (ssh connection closed) on trc-alpine: sessions lost in 1000 cycles                                                              | 0.0    | 0          |
| NFR-07 | app quit (ssh connection closed) on trc-alpine: connect again (ssh and daemon check), p95 of 1000                                         | 495 ms | ≤ 5,000 ms |
| NFR-11 | network flap (connection stalled, then a new one) on trc-alpine: sessions lost in 1000 cycles                                             | 0.0    | 0          |
| NFR-07 | network flap (connection stalled, then a new one) on trc-alpine: connect again (ssh and daemon check), p95 of 1000                        | 472 ms | ≤ 5,000 ms |
| NFR-11 | app crash (ssh process killed) on trc-rocky: sessions lost in 1000 cycles                                                                 | 0.0    | 0          |
| NFR-07 | app crash (ssh process killed) on trc-rocky: connect again (ssh and daemon check), p95 of 1000                                            | 520 ms | ≤ 5,000 ms |
| NFR-11 | logout without lingering (KillUserProcesses=no) on trc-systemd: sessions lost in 1000 cycles                                              | 0.0    | 0          |
| NFR-07 | logout without lingering (KillUserProcesses=no) on trc-systemd: connect again (ssh and daemon check), p95 of 1000                         | 382 ms | ≤ 5,000 ms |
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
  `upgrade.lock` (US-2.5.3); only this build's connections are timed. This build's core adopts 0.2.0's holders,
  which speak the previous holder protocol, 1,000 times on each host; NFR-12's app-to-daemon compatibility is
  covered by the protocol tests (ST-24, ST-26).
- The logout cycles wait until logind reports every login of the user closing, then past `UserStopDelaySec`
  (10 s), and check every cycle that the core from before the logout still runs, detached in the login session's
  scope.
- The daemon kill and upgrade scenarios run with lingering on `trc-systemd-linger`, where the core is a systemd
  unit, and on `trc-ubuntu`, which has no systemd, so the core runs detached. On a systemd host without lingering
  the core also runs detached (US-2.4); the logout scenario checks that mode on `trc-systemd`, and the kill and
  upgrade cycles were not repeated there.

## Findings

- **NFR-02's target changed during ST-36** (P-35, P-36). The UI test compared the app's p95 with the link's median
  round trip, but the 100 ms test link jitters by about 5 ms, so the app's 116.6 to 118.4 ms missed by 0.4 and 0.5 ms
  in 2 of 8 runs (the table below). The owner first chose the link's own p95 as the baseline (P-35), then made the
  target p99 within one 60 Hz frame (16.7 ms) of the round trip (P-36): an echo one frame late goes unnoticed, and a
  p99 also bounds the slow keystrokes. With the larger allowance, a return to the 13 ms S13 measured before D-47 on
  the 1 ms link would no longer fail the test; the owner accepted that. Sampling the link during the typing was tried
  and dropped, as the test runner's own load inflated its pings on the 1 ms link. Running the test window opaque or
  nearly transparent changed nothing.
- **NFR-09 holds on the primary screen, with an E2 exception** (P-37). Snapshots stream 256 rows at a time within the
  client's credit (S12), so a second client attaching a full holder at the 100,000-line maximum adds 1.6 MiB (under 2
  MiB in every run). While a full-screen program runs, a full snapshot streams from a copy of the primary screen and
  its scrollback, as libghostty-vt formats only the active screen: about 95 MiB at the maximum and 10 MiB at the
  default, for as long as that snapshot streams (another client attaching from the start, or review mode or find
  filling a gap), and each client attaching that way holds its own. E3 resolves it.
- **The detached daemon keeps a logged-out user's login `closing`.** Its processes stay in the login's session
  scope, as tmux's do, so logind never ends the login and systemd keeps the user's manager running (S11). Sessions
  and the core survive either way.
- **S3b's question changed with D-04.** E1 measured throughput under backpressure; in E2 a client that runs out
  of credit is resynced instead, so the 100 ms test now checks that Ctrl+C still arrives promptly and that the
  program is never blocked.
- **Every UI measurement ran in an unseen window** (D-27): click-through, transparent, in the screen's corner and
  never focused, so the tests never take the developer's keyboard; a launch test checks that such a window still
  draws at least 80% of the display's frames.

NFR-02 on `trc-latency` before P-36: the app's p95 against the baseline plus 10 ms, one UI test run per row on
2026-11-15:

| Run | Window                    | Baseline                   | Baseline value | App p95  | Budget     | Result |
| --- | ------------------------- | -------------------------- | -------------- | -------- | ---------- | ------ |
| 1   | unseen                    | median                     | 107.2 ms       | 117.6 ms | ≤ 117.2 ms | miss   |
| 2   | unseen                    | median                     | 107.8 ms       | 118.3 ms | ≤ 117.8 ms | miss   |
| 3   | unseen                    | median                     | 109.2 ms       | 118.4 ms | ≤ 119.2 ms | pass   |
| 4   | unseen                    | median                     | 108.5 ms       | 116.6 ms | ≤ 118.5 ms | pass   |
| 5   | nearly transparent (0.01) | median                     | 109.9 ms       | 117.5 ms | ≤ 119.9 ms | pass   |
| 6   | nearly transparent (0.01) | median                     | 108.2 ms       | 117.7 ms | ≤ 118.2 ms | pass   |
| 7   | opaque                    | median                     | 109.2 ms       | 117.2 ms | ≤ 119.2 ms | pass   |
| 8   | opaque                    | median                     | 110.5 ms       | 118.0 ms | ≤ 120.5 ms | pass   |
| 9   | unseen                    | p95, sampled while typing  | 114.2 ms       | 119.1 ms | ≤ 124.2 ms | pass   |
| 10  | unseen                    | p95, sampled while typing  | 114.7 ms       | 118.8 ms | ≤ 124.7 ms | pass   |
| 11  | unseen                    | p95, sampled while typing  | 114.0 ms       | 117.2 ms | ≤ 124.0 ms | pass   |
| 12  | unseen                    | p95, sampled before typing | 116.4 ms       | 117.1 ms | ≤ 126.4 ms | pass   |
| 13  | unseen                    | p95, sampled before typing | 115.0 ms       | 118.0 ms | ≤ 125.0 ms | pass   |
| 14  | unseen                    | p95, sampled before typing | 114.3 ms       | 122.3 ms | ≤ 124.3 ms | pass   |

## Not measured here

- Speech itself: NFR-04 is measured to the announcement request; the VoiceOver passes in
  `docs/verification/E2-manual-at.md` check that speech follows.
- Network changes and wake (P-34): they retry at once, as `reconnector.test.ts` checks; the soak's flaps stand in
  for the loss itself.

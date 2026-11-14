# E1 fidelity and NFR verification (ST-19)

Measured on 2026-11-13 by `pnpm test:nfr` and `pnpm test:e2e` against the test hosts (`tools/test-hosts`, P-04).
`node tools/nfr-report/nfr-report.ts` prints each run's table from `apps/desktop/nfr-results/results.jsonl`.

## Conditions

| Item         | Value                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------- |
| Client       | Apple M3 Pro, 36 GiB, macOS 26.7.3, display at 100 Hz, OpenSSH 10.5p1                       |
| Test hosts   | colima profile `trc`: aarch64 VM, 4 CPUs, 6 GiB, Docker; Ubuntu 24.04, Rocky 9 and Alpine   |
| Network      | `127.0.0.1` port forwards into the VM; `trc-latency` adds 100 ms with `tc netem` (egress)   |
| Builds       | The app's test build (P-14) for the UI half; the connection host in Node for the other half |
| Credit       | 1 MiB per stream, tuned in this story (S3b)                                                 |
| Measurements | p95 by nearest rank; RTT is the median ping-to-pong time over the host's SSH channel        |

## Results

One full run, both halves, nothing else running on the machine:

| ID     | Measurement                                                                   | Value      | Target     |
| ------ | ----------------------------------------------------------------------------- | ---------- | ---------- |
| NFR-02 | trc-ubuntu: SSH round trip, ping to pong over the channel (median)            | 0.9 ms     | —          |
| NFR-02 | trc-ubuntu: keystroke to echo at the connection host, p95                     | 7.3 ms     | ≤ 10.9 ms  |
| NFR-02 | trc-latency: SSH round trip, ping to pong over the channel (median)           | 106 ms     | —          |
| NFR-02 | trc-latency: keystroke to echo at the connection host, p95                    | 109 ms     | ≤ 115.9 ms |
| NFR-03 | trc-ubuntu: Ctrl+C under `python3` flood until the program reports it, p95    | 8.0 ms     | ≤ 100 ms   |
| S3b    | trc-ubuntu: output rate with a 1024 KiB credit window                         | 60.5 MiB/s | —          |
| S3b    | trc-latency: output rate with a 1024 KiB credit window                        | 8.4 MiB/s  | —          |
| NFR-07 | trc-rocky paused: time until the app marks it disconnected                    | 19.9 s     | ≤ 30 s     |
| NFR-09 | idle core, no sessions: resident memory                                       | 1.9 MiB    | ≤ 30 MB    |
| NFR-09 | idle core: CPU over 10 s                                                      | 0.0 %      | ≤ 0.5%     |
| NFR-09 | per session (largest holder plus the core's growth), 10 idle sessions         | 2.7 MiB    | ≤ 10 MB    |
| NFR-10 | holder with the default 10,000 lines, full                                    | 14.0 MiB   | bounded    |
| NFR-10 | holder with the default 10,000 lines: growth after 40000 more lines           | 0.2 MiB    | ≈ 0        |
| NFR-10 | holder with the 100,000-line maximum, full                                    | 104 MiB    | bounded    |
| NFR-10 | holder with the 100,000-line maximum: growth after 300000 more lines          | 3.5 MiB    | ≈ 0        |
| NFR-05 | trc-ubuntu: create a session, with up to 100 running, p95                     | 3.8 ms     | —          |
| NFR-05 | trc-ubuntu: rename to session event, 100 sessions, p95                        | 1.1 ms     | ≤ 250 ms   |
| NFR-05 | trc-ubuntu: keystroke to echo with 101 sessions, p95                          | 5.0 ms     | ≤ 10.9 ms  |
| NFR-05 | 25 hosts: connect and install all at once                                     | 1.4 s      | —          |
| NFR-05 | 25 hosts: rename to session event, p95                                        | 5.1 ms     | ≤ 250 ms   |
| NFR-05 | 25 hosts: keystroke to echo, every keystroke on every host, p95               | 5.5 ms     | ≤ 12.2 ms  |
| SEC-08 | log files holding a typed, printed or environment canary                      | 0 files    | 0          |
| NFR-02 | trc-ubuntu: keystroke to its echo parsed in the app, p95                      | 11.6 ms    | ≤ 10.8 ms  |
| NFR-02 | trc-ubuntu: keystroke to its echo on the text surface (next frame), p95       | 22.1 ms    | next frame |
| NFR-02 | trc-latency: keystroke to its echo parsed in the app, p95                     | 113 ms     | ≤ 115.8 ms |
| NFR-02 | trc-latency: keystroke to its echo on the text surface (next frame), p95      | 119 ms     | next frame |
| NFR-03 | trc-ubuntu: Ctrl+C in the app to SIGINT in the flooding program, p95          | 10.5 ms    | ≤ 100 ms   |
| NFR-03 | trc-ubuntu: time between frames while the flood runs, p95                     | 10.9 ms    | ≤ 100 ms   |
| NFR-04 | trc-ubuntu, screen-reader mode: Return to the announcement of the output, p95 | 120–435 ms | ≤ 500 ms   |
| NFR-06 | launch to an interactive window (test build, Playwright included), worst of 5 | 625 ms     | ≤ 2,000 ms |

NFR-04 comes from two runs after the full run, whose NFR-04 test stopped before measuring when the Add host list
did not show its suggestion in time; across runs it measured 120, 122, 421, 432 and 435 ms.

US-1.11.5: `test/e2e/programs.spec.ts` drives vim, neovim, less, top, htop, tmux inside tmux, git with its pager, a
nested ssh login and the Python REPL through the app's keyboard path on `trc-ubuntu`, and reads each screen from
the text surface. It passed three runs in a row.

## Findings

- **NFR-02 is not met on a sub-millisecond link, by about 1 ms.** From keydown to the echo parsed in the terminal
  the app adds 10.2 to 10.7 ms at p95 on `trc-ubuntu` (11.1 to 11.6 ms measured against a 0.9 ms round trip), above
  the 10 ms budget; on `trc-latency` it adds 7 ms and passes. The renderer posts the key within 0.2 ms; the spread,
  2.6 to 12 ms, is in Electron's message delivery between the renderer and the connection host's utility process,
  since the same round trip without those hops measures 7.3 ms at p95. On screen the echo appears at the next
  display frame, one more 10 ms frame at 100 Hz, which no app can avoid and which the target cannot have meant to
  include. **The owner accepted this for E1 on 2026-11-13.** The UI test keeps the PRD's 10 ms on the 100 ms host
  and guards the local link at 15 ms against regressions; E2 may revisit the port path between the renderer and the
  utility process.
- **Attaching briefly doubles a snapshot in memory** (Rust review M6): the formatter's buffer and its copy coexist,
  and the gate holds the copy until credit drains it. At the 100,000-line maximum that passes NFR-09's 10 MB per
  session for a moment; the default and the steady state meet it. The owner deferred streaming the snapshot to E2
  on 2026-11-13, and the PRD records it as an E1 exception.
- **S3b tuned the credit window from 256 KiB to 1 MiB.** At 100 ms RTT the window bounds throughput at about the
  window over the round trip: 256 KiB gave 2.2 MiB/s and 1 MiB gives 8.4 MiB/s, while Ctrl+C under a flood still
  arrives within 11 ms at p95. OpenSSH's 2 MiB channel window bounds it beyond that.
- **ssh says nothing when a server drops a connection before login.** With `LogLevel ERROR`, a busy sshd
  (`MaxStartups`) closes the connection without a message, and the failure had empty details. It now reads "ssh
  ended the connection without a message" (US-1.3.1). The 25-host test raises `MaxStartups` on its one shared sshd,
  which stands in for 25 servers.
- **Release builds held the test seam and opened a debugging listener** (found by ST-20's artifact check, fixed
  there): `--remote-debugging-port` opened a DevTools port on `127.0.0.1`, and the `TRC_TEST_*` names were only
  gated at runtime.

## Not measured here

- Speech itself: NFR-04 is measured to the announcement request; the VoiceOver passes in
  `docs/verification/E1-manual-at.md` check that speech follows.
- NFR-06's "remote reconnects started" (E2) and NFR-07's reconnect time (E2).

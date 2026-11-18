# E4 NFR verification and soak (ST-59)

Measured on 2026-11-17 on This computer, the owner's Mac, and on the macOS test host (P-57), by the NFR tests with
`TRC_NFR_HOST=local`, `ui.spec.ts` and the soak scenarios `launchd.soak.test.ts` and `app.spec.ts`.
`node tools/nfr-report/nfr-report.ts` prints a run's table from `apps/desktop/nfr-results/results.jsonl`. E1's to
E3's results (`E1-nfr.md` to `E3-nfr.md`) still describe the Linux hosts, which E4 did not change.

## Conditions

| Item          | Value                                                                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client        | Apple M3 Pro, 36 GiB, macOS 26.7.3, display at 100 Hz                                                                                                                                    |
| This computer | The same Mac: the universal daemon from `pnpm build:daemon` installed in a scratch home, its core a temporary LaunchAgent in the user's GUI domain (P-58)                                |
| macOS host    | A tart VM of macOS 26.6.2, arm64, 4 CPUs, 8 GiB, on lima's user-mode network with SSH on `127.0.0.1:2230` (D-53); `trc-mac-gui` logs in to the GUI at boot, so its core is a LaunchAgent |
| Builds        | The app's test build (P-14), opened unseen in the screen's corner (D-27), for the UI half; the connection host in Node for the rest                                                      |
| Measurements  | Percentiles by nearest rank; memory in MiB, against NFR-09's "MB" targets                                                                                                                |

The rows named `local` are This computer: the harness reaches it as a live host named `local`. Its "connect again"
rows time the local shell and the daemon check, as no ssh runs.

## Results

NFR-01, NFR-05 and NFR-09 ran with `ebee532`'s tests, against `2b82e2b`'s daemon or `41d0466`'s, which changes only
the plist; the soaks ran on `41d0466`'s daemon, whose LaunchAgent restarts a crashed core within a second.

| ID     | Measurement                                                                  | Value   | Target     |
| ------ | ---------------------------------------------------------------------------- | ------- | ---------- |
| NFR-01 | This computer: keystroke to its echo parsed in the app, p50                  | 1.4 ms  | —          |
| NFR-01 | This computer: keystroke to its echo parsed in the app, p95                  | 2.3 ms  | —          |
| NFR-01 | This computer: keystroke to its echo parsed in the app, p99                  | 2.7 ms  | ≤ 16.7 ms  |
| NFR-01 | This computer: keystroke to its echo on the text surface (next frame), p99   | 14.8 ms | next frame |
| NFR-05 | local: create a session, with up to 100 running, p95                         | 16.7 ms | —          |
| NFR-05 | local: rename to session event, 100 sessions, p95                            | 0.3 ms  | ≤ 250 ms   |
| NFR-05 | local: keystroke to echo with 101 sessions, p99                              | 0.5 ms  | ≤ 17.0 ms  |
| NFR-09 | local: idle core, no sessions: resident memory                               | 2.1 MiB | ≤ 30 MB    |
| NFR-09 | local: idle core: CPU over 10 s                                              | 0.0 %   | ≤ 0.5%     |
| NFR-09 | local: per session (largest holder plus the core's growth), 10 idle sessions | 3.5 MiB | ≤ 10 MB    |

- **NFR-09 on macOS** reads resident memory and CPU time with `ps`, as macOS has no `/proc`; the idle core is the
  universal binary's arm64 slice.

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

- **Found by the soak.** launchd respawns a `KeepAlive` job at most every 10 s by default, so a core killed within
  10 s of its start left the next connection waiting: the first short run measured 10.3 s at p95 on This computer and
  9.9 s on the VM, over NFR-07. The plist's `ThrottleInterval` of 1 s (`41d0466`, P-60) brought it to the values
  above.
- **Logout** (US-4.4.2, P-62): `mac-logout.integration.test.ts` logs `trc-mac-gui` out of the GUI, checks that the
  next connection's detached core adopts every shell with its output and input, then reboots the VM, whose user
  logs in again. Linux's logout soak is E3's (`E3-nfr.md`).
- **Upgrades** cannot start from an older macOS daemon, as 0.4.0 shipped none; the soak has the running core report
  0.0.1, which takes the bridge's upgrade path from there on.

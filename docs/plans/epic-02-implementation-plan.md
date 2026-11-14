# Epic 2 implementation plan: remote sessions that outlive the app and the network

| Field  | Value                                                                                     |
| ------ | ----------------------------------------------------------------------------------------- |
| Status | v1: owner decisions taken on 2026-11-13; the session executes it under P-20               |
| Owner  | Renato Oliveira                                                                           |
| Scope  | PRD §9.2 (US-2.1 to US-2.6) plus every global requirement for what E2 delivers            |
| Inputs | [PRD.md](../PRD.md) v0.11, [TECH_STACK.md](../TECH_STACK.md) v1.4, the E1 plan and v0.2.0 |

## 1. Context

E1 shipped as v0.2.0. Its daemon already keeps sessions alive while the app is away: the bridge starts the core
detached, every holder runs in its own session, and a new core adopts the holders a previous one started. What E2
adds:

- the app reconnects by itself, reattaches from where each terminal stopped, and restores every host at launch;
- programs never block on a slow client, and several Macs share a session;
- the daemon survives logout where the host allows it, says so where it cannot, restarts after a crash, and
  upgrades in place without ending a session;
- the soak tests behind NFR-11, and the two E1 exceptions (NFR-02, NFR-09) closed.

E2 must retire R4, R5 and R6 on Linux. E1's working agreement (E1 plan §3: read, red, green, refactor, gate, docs,
commit, continue) and its autonomy rule (P-20) apply unchanged.

## 2. Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-22 | Story and decision numbers continue from the E1 plan (ST-22 onward, P-22 onward), so every identifier stays unique across plans.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| P-23 | **Owner, 2026-11-13.** Linux service mode uses systemd only as it already is: when `loginctl` reports `Linger=yes`, the core runs as a transient user unit (`systemd-run --user`, restarted on failure) and each holder in its own transient scope, outside the unit's control group. The app never runs `loginctl enable-linger` and writes nothing outside the install root. Without lingering the core runs detached as in E1, except where logind ends user processes at logout (`KillUserProcesses=yes`): there the core and holders run under the user manager, which outlives each connection until the last one closes, and the app warns (US-2.4.4); this rule waits for the owner's confirmation after S11. Recorded as D-44. |
| P-24 | **Owner, 2026-11-13.** A client that falls behind during a flood skips to the latest screen (D-04). The skipped lines are filled by rebuilding the client's terminal from the daemon's full scrollback and screen, streamed, once output pauses and before review mode or find opens. `ReadRows` is dropped, since xterm.js cannot insert rows into the middle of its buffer. Recorded as D-45.                                                                                                                                                                                                                                                                                                                                         |
| P-25 | **Owner, 2026-11-13.** NFR-11's app quit and crash cycles run 1,000 times at the ssh level (closing or killing the app's real ssh connection, which is all an app quit or crash does to a host), plus 50 real app launches each with quit and with crash, in the background with a scratch `TRC_HOME`. Daemon kill, daemon upgrade and network flap cycles run 1,000 times each.                                                                                                                                                                                                                                                                                                                                                        |
| P-26 | **Owner, 2026-11-13.** US-2.1.5's notice is a dialog shown once, the first time the user quits while sessions run: Quit, Quit and Stop All Sessions, Cancel. The PRD's criterion is amended to match.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| P-27 | The app upgrades a host's daemon on connect whenever it bundles a newer one than the core that runs (US-2.5.3): the new bridge stops the older core (never a newer one) and starts its own, which adopts every holder. Holders are never upgraded: a session started by 0.1.0 or 0.2.0 keeps its holder, and with it E1's behavior (one client at a time, backpressure), until it is closed. A newer installed daemon no longer means "update the app": the app uses it when the protocol overlaps and asks for an update only on `Incompatible` (US-1.4.6, NFR-12). Recorded as D-46.                                                                                                                                                  |
| P-28 | Protocol 2 (N = 2, N−1 = 1). A proto-1 client gets E1's attach and, when it falls behind, an in-band reset followed by the full snapshot, since it does not know `resync`. The core speaks holder protocol 1 (E1 holders) and 2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| P-29 | Reconnect policy (US-2.2): after a loss, retry at once, then after 1, 2 and 4 s, then every 5 s for 5 minutes, then every 30 s, each with ±20% jitter. A network change or a wake retries at once and restarts the sequence. Failures that need the user (authentication, host keys, an unsupported host, an install problem, an incompatible daemon, a missing ssh) stop retrying until the user selects Retry (US-2.2.4).                                                                                                                                                                                                                                                                                                             |
| P-30 | The app caches each host's session list in the TRC home's `sessions.json` (0600, written atomically, read with zod, SEC-05.1): id, name, title, order and state as last listed. At launch the cached sessions show at once as Reconnecting (US-2.3.2). Connecting every known host at launch, as E1 does, stays.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| P-31 | Shared sessions (US-2.6.2): a client sends its size when its terminal gains focus or sends input and the session's size differs. A client whose size is not the session's renders the session at the session's size and says "Size set by another client" in the status bar and the terminal's description.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| P-32 | A systemd test host joins `tools/test-hosts`: Ubuntu with systemd as PID 1 and logind, ports on `127.0.0.1` only, in three variants (lingering on; off with `KillUserProcesses=no`; off with `KillUserProcesses=yes`). Like the other test hosts it runs locally, not in GitHub Actions.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| P-33 | Review at the end of E2: `code-reviewer` (TypeScript, Rust) and `technical-auditor` (security, reliability and release) over every commit after v0.2.0, in rounds until no critical or high finding remains. A fix that would change the PRD, behavior, a design or an owner decision waits for the owner. Then the release workflow cuts `v0.3.0` (`bump: minor`, P-21).                                                                                                                                                                                                                                                                                                                                                               |

## 3. Design

### 3.1 Holder protocol 2 (D-04, P-24, P-28)

- **Output log.** The holder numbers every output byte with a 64-bit offset and keeps the last 1 MiB of raw output.
- **Attachments.** The holder serves any number of attachments over its one core connection. Each attachment has
  its own stream, credit and queue. The holder never stops reading the PTY.
- **Attach from an offset.** `attach { fromOffset }` replays from the log when the offset is still in it (a
  delta), and otherwise sends a snapshot. Either replay ends with `synced { offset }`, after which every byte is
  live output at that offset.
- **Falling behind.** An attachment whose queue passes its window is behind: its queue is dropped and nothing more
  is queued. Once its credit has come back, it gets `resync { kind: screen }`, the current screen and `synced`.
  `refresh` asks for `resync { kind: full }`, the whole scrollback and screen, which the app requests once output
  pauses and before review mode or find opens.
- **Streamed snapshots** (NFR-09). Snapshots are formatted a block of rows at a time, within the attachment's
  credit, from rows tracked as output moves them (spike S12), so neither the program nor other clients wait, and a
  snapshot never sits whole in memory.
- **Input from others.** Input on one attachment tells the others, at most once a second each (US-2.6.4).
- **Legacy.** An attachment the core marks legacy (a proto-1 client) gets `ESC c` and the full snapshot when it
  catches up, with no `resync` or `synced`.

### 3.2 Core and service mode (US-2.4, US-2.5, P-23, P-27)

- Many clients per session; each client's streams map to holder attachments. Holder protocol 1 sessions keep one
  attachment, as in E1.
- `SIGTERM` stops the core cleanly; the holders keep running. `core.lock` records the PID, version and SHA-256.
- The bridge picks how the core runs:
    - `Linger=yes`: a transient unit `trcd-<root hash>` with `Restart=on-failure`; holders start through
      `systemd-run --user --scope`.
    - lingering off and `KillUserProcesses=yes`: the same, under the user manager, and the core reports that
      sessions end when the last connection closes.
    - otherwise, or with no systemd user manager: detached, as in E1.
- Upgrade: the bridge of the newest installed version reads `core.lock`, and if the core holding it is older, stops
  it (the unit, or `SIGTERM` after checking that its executable lies in this install's `versions/`), waits for the
  lock, and starts its own core. A core never replaces a newer one.
- `welcome` reports the service mode and whether sessions end at logout.

### 3.3 App (US-2.1–US-2.3, US-2.6)

- **Connection host.** A `reconnecting` state with the attempt, the next try and the last failure; the P-29 policy;
  retry now and stop retrying per host; network change (interface list polled every 2 s) and wake (`powerMonitor`)
  retry at once, and a wake pings a connected host at once.
- **Terminals.** Each terminal counts the live bytes it parsed. Reattaching asks for `fromOffset`; a delta keeps
  the buffer, scroll position and review mode as they were; a snapshot rebuilds the terminal. `resync` replaces the
  buffer without speaking it; the rebuild waits for a pause or for review mode or find. Typing while a host
  reconnects says "Reconnecting — input not sent".
- **Restore at launch.** `sessions.json` supplies the list at once; every host connects in parallel; the UI never
  waits for a host.
- **Quitting.** "Quit and Stop All Sessions…" (app menu, palette) stops every session on every connected host after
  a confirmation with the counts, and names any host it could not reach. The first-quit dialog (P-26).
- **Shared sessions.** P-31, plus "Input from another client" announced politely once per burst.

## 4. Stories

**ST-22 Plan and decisions**

- This plan; TECH_STACK D-44 to D-46, the E2 rows of §5.4, §6, §10 and §11 (spikes S11 to S13); the PRD's US-2.1.5
  amendment (P-26), v0.11; the doc-ID check reads this plan.
- Done when the doc-ID check passes and `docs(plan): ...` is committed.

**ST-23 Spikes S11, S12, S13** (R4, R5, R6, NFR-02, NFR-09)

- **S11 systemd.** A systemd test host on colima: a transient unit core with `Restart=on-failure`, holders in
  `systemd-run --user --scope`, lingering and `KillUserProcesses` detection, and what survives logout,
  `UserStopDelaySec` and `systemctl --user stop` in each P-32 variant.
- **S12 streamed snapshot.** Formatting rows in blocks through the formatter's selection and tracked grid
  references while output keeps arriving: consistency against a whole snapshot, peak memory at 100,000 lines.
- **S13 port path.** Where the 2.6 to 12 ms spread between the renderer and the connection host comes from, and a
  fix that holds NFR-02 on a sub-millisecond link.
- Findings in `docs/spikes/S11.md` to `S13.md`; the plan is revised if one contradicts a decision.

**ST-24 Protocol 2** (NFR-12, US-2.2.2, US-2.6)

- `PROTOCOL_VERSION` 2, minimum 1. `attach.fromOffset`, `attached.replay`, `synced`, `resync`, `refresh`,
  `peerInput`, and the service fields of `welcome`. Fixtures `v2` beside `v1`; ts-rs and zod.

**ST-25 Holder protocol 2** (D-04, US-2.1.2, US-2.6.1, NFR-09)

- §3.1. Unit tests for the output log, the attachment gate and resync; integration tests in the containers.

**ST-26 Core: shared sessions and both protocols** (US-2.6.1/3, NFR-12)

- Many attachments per session, protocol 1 and 2 clients, holder protocol 1 and 2, `SIGTERM`, the new `core.lock`.

**ST-27 Service mode and kill scope** (US-2.4, US-2.5.1–2, R4, R5, R6)

- §3.2's service rules, detection and `welcome` fields; the systemd test host (P-32).
- The US-2.5.2 test: kill the core, let it restart, and every shell survives, in each variant and on Ubuntu,
  Alpine and Rocky.

**ST-28 Upgrade in place** (US-2.5.3–4, US-1.4.6, NFR-12)

- The install plan and bridge rules of P-27; "Upgrade daemon" on an incompatible older daemon. Tests upgrade from
  a 0.2.0 install with running sessions and from a protocol-2 core, and check that no newer core is replaced.

**ST-29 Automatic reconnect in the connection host** (US-2.2, NFR-07)

- The `reconnecting` state, the P-29 policy, retry now, stop retrying, network and wake triggers.

**ST-30 Reattach, resync and rebuild in the renderer** (US-2.1.3, US-2.2.2, A11Y-02.3, A11Y-03, A11Y-12)

- §3.3's terminal behavior; Reconnecting in the session tree and status bar; "Reconnected" shown and announced;
  Retry and Stop retrying per host.

**ST-31 Restore at launch** (US-2.3, NFR-06)

- `sessions.json`, parallel connects, cached sessions shown as Reconnecting, failures that show their reason and
  retry.

**ST-32 Shared sessions in the app** (US-2.6)

- P-31's size rule and indicator, the "Input from another client" announcement, and an e2e with a second client
  driven over ssh by the test.

**ST-33 Quitting** (US-2.1.1/4/5)

- "Quit and Stop All Sessions…", the first-quit dialog, and e2e checks that quit, crash and force-kill end no
  session.

**ST-34 Hosts where sessions end at logout** (US-2.4.4)

- The host's status says sessions end when the last connection closes, and a warning precedes the first session
  created there.

**ST-35 NFR-02 on a sub-millisecond link**

- S13's fix, and the UI test's local guard back at the PRD's 10 ms.

**ST-36 Soak and E2 verification** (NFR-11, NFR-06, NFR-07, NFR-09, NFR-12, S6)

- The P-25 soak: each cycle checks that every session's shell keeps its PID and its output. NFR-06, NFR-07 and
  NFR-09 measured again. Results in `docs/verification/E2-nfr.md`.

**ST-37 Release gate, reviews and v0.3.0** (PRD §9 done)

- The full suites; `docs/verification/E2-manual-at.md` and `E2-security.md`; the P-33 reviews; final pass over
  CLAUDE.md, README, USER_GUIDE, TECH_STACK and PRD; release `v0.3.0`.

## 5. Traceability

| PRD item | Stories                   | PRD item       | Stories                   |
| -------- | ------------------------- | -------------- | ------------------------- |
| US-2.1   | ST-25, ST-30, ST-33       | NFR-02         | ST-23 (S13), ST-35        |
| US-2.2   | ST-24, ST-29, ST-30       | NFR-06, NFR-07 | ST-29, ST-31, ST-36       |
| US-2.3   | ST-31                     | NFR-09         | ST-23 (S12), ST-25        |
| US-2.4   | ST-23 (S11), ST-27, ST-34 | NFR-11         | ST-36                     |
| US-2.5   | ST-27, ST-28              | NFR-12         | ST-24, ST-26, ST-28       |
| US-2.6   | ST-24–ST-26, ST-32        | R4, R5, R6     | ST-23 (S11), ST-27, ST-36 |

## 6. Human checkpoints

| When  | The owner does                                                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| ST-37 | Decide any review finding whose fix would change the PRD, behavior, a design or an owner decision; test the build; accept the gate. |

## 7. Status

| Story | Status  | Commit |
| ----- | ------- | ------ |
| ST-22 | Done    | —      |
| ST-23 | Pending | —      |
| ST-24 | Pending | —      |
| ST-25 | Pending | —      |
| ST-26 | Pending | —      |
| ST-27 | Pending | —      |
| ST-28 | Pending | —      |
| ST-29 | Pending | —      |
| ST-30 | Pending | —      |
| ST-31 | Pending | —      |
| ST-32 | Pending | —      |
| ST-33 | Pending | —      |
| ST-34 | Pending | —      |
| ST-35 | Pending | —      |
| ST-36 | Pending | —      |
| ST-37 | Pending | —      |

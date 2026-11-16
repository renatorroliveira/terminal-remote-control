# Epic 2 implementation plan: remote sessions that outlive the app and the network

| Field  | Value                                                                                     |
| ------ | ----------------------------------------------------------------------------------------- |
| Status | v1: owner decisions taken on 2026-11-13; the session executes it under P-20               |
| Owner  | Renato Oliveira                                                                           |
| Scope  | PRD §9.2 (US-2.1 to US-2.6) plus every global requirement for what E2 delivers            |
| Inputs | [PRD.md](../PRD.md) v0.13, [TECH_STACK.md](../TECH_STACK.md) v1.6, the E1 plan and v0.2.0 |

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

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P-22 | Story and decision numbers continue from the E1 plan (ST-22 onward, P-22 onward), so every identifier stays unique across plans.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P-23 | **Owner, 2026-11-13.** Linux service mode uses systemd only as it already is: when `loginctl` reports `Linger=yes`, the core runs as a transient user unit (`systemd-run --user`, restarted on failure) and each holder in its own transient scope, outside the unit's control group. The app never runs `loginctl enable-linger` and writes nothing outside the install root. Without lingering the core runs detached as in E1, except where logind ends user processes at logout (`KillUserProcesses=yes`): there the core and holders run under the user manager, which outlives each connection until the last one closes, and the app warns (US-2.4.4); the owner confirmed this rule on 2026-11-14 after S11 showed a detached core ending with its connection there. Recorded as D-44.                                                                                                                                             |
| P-24 | **Owner, 2026-11-13.** A client that falls behind during a flood skips to the latest screen (D-04). The skipped lines are filled by rebuilding the client's terminal from the daemon's full scrollback and screen, streamed, once output pauses and before review mode or find opens. `ReadRows` is dropped, since xterm.js cannot insert rows into the middle of its buffer. Recorded as D-45.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P-25 | **Owner, 2026-11-13.** NFR-11's app quit and crash cycles run 1,000 times at the ssh level (closing or killing the app's real ssh connection, which is all an app quit or crash does to a host), plus 50 real app launches each with quit and with crash, in the background with a scratch `TRC_HOME`. Daemon kill, daemon upgrade and network flap cycles run 1,000 times each.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P-26 | **Owner, 2026-11-13.** US-2.1.5's notice is a dialog shown once, the first time the user quits while sessions run: Quit, Quit and Stop All Sessions, Cancel. The PRD's criterion is amended to match.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P-27 | The app upgrades a host's daemon on connect whenever it bundles a newer one than the core that runs (US-2.5.3): the new bridge stops the older core (never a newer one) and starts its own, which adopts every holder. Holders are never upgraded: a session started by 0.1.0 or 0.2.0 keeps its holder, and with it E1's behavior (one client at a time, backpressure), until it is closed. A newer installed daemon no longer means "update the app": the app uses it when the protocol overlaps and asks for an update only on `Incompatible` (US-1.4.6, NFR-12). Recorded as D-46.                                                                                                                                                                                                                                                                                                                                                     |
| P-28 | Protocol 2 (N = 2, N−1 = 1). A proto-1 client gets E1's attach and, when it falls behind, an in-band reset followed by the full snapshot, since it does not know `resync`. The core speaks holder protocol 1 (E1 holders) and 2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P-29 | Reconnect policy (US-2.2): after a loss, retry at once, then after 1, 2 and 4 s, then every 5 s for 5 minutes, then every 30 s, each with ±20% jitter. A network change or a wake retries at once and restarts the sequence (P-34). Failures that need the user (authentication, host keys, an unsupported host, an install problem, an incompatible daemon, a missing ssh) stop retrying until the user selects Retry (US-2.2.4). Only install failures that may pass (`lock-busy`, `short-upload`, `checksum-mismatch`) retry, at most 3 times in a row (P-34).                                                                                                                                                                                                                                                                                                                                                                          |
| P-30 | The app caches each host's session list in the TRC home's `sessions.json` (0600, written atomically, read with zod, SEC-05.1): id, name, title, order and state as last listed. At launch the cached sessions show at once as Reconnecting (US-2.3.2). Connecting every known host at launch, as E1 does, stays.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P-31 | Shared sessions (US-2.6.2): a client sends its size when its terminal gains focus or sends input and the session's size differs; after a reconnect only the open terminal sends its size (P-34). A client whose size is not the session's renders the session at the session's size and says "Size set by another client" in the status bar and the terminal's description.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| P-32 | A systemd test host joins `tools/test-hosts`: Ubuntu with systemd as PID 1 and logind, ports on `127.0.0.1` only, in three variants (lingering on; off with `KillUserProcesses=no`; off with `KillUserProcesses=yes`). Like the other test hosts it runs locally, not in GitHub Actions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| P-33 | Review at the end of E2: `code-reviewer` (TypeScript, Rust) and `technical-auditor` (security, reliability and release) over every commit after v0.2.0, in rounds until no critical or high finding remains. A fix that would change the PRD, behavior, a design or an owner decision waits for the owner. Then the release workflow cuts `v0.3.0` (`bump: minor`, P-21).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P-34 | **Owner, 2026-11-14, review round 1.** (a) After a reconnect only the open terminal sends its size; the others take theirs back on focus or input, as P-31 says (F6). (b) When another client opens a session whose E1 holder serves one client at a time, the core tells the client it replaced with `detached { reason: attachedElsewhere }` (protocol 2); its terminal says "Opened on another client — input not sent", and opening the session again takes it back (M4). (c) Install failures retry only when they may pass, at most 3 times in a row (M2). (d) A holder whose systemd scope cannot start still starts directly, and the core's unit runs with `KillMode=process`, so stopping or restarting the core never ends it (M3). (e) **Owner, 2026-11-15, review round 2.** A network change or a wake retries a waiting host at once, every time, as US-2.2.2 says; the 5 s spacing round 1 added is dropped (audit R2 F2). |
| P-35 | **Owner, 2026-11-15, ST-36.** NFR-02's UI test compares the app's p95 echo with the link's own p95 round trip, sampled over another connection just before the typing, instead of its median: the 100 ms test link jitters by about 5 ms, which the median baseline counted as the app's. The connection-host and scale tests keep the median, a stricter check they meet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

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
- Upgrade: the bridge of the newest installed version reads `core.lock`, and if the core holding it is older, takes
  `run/upgrade.lock`, reads `core.lock` again, stops the core (the unit, or `SIGTERM` after checking that its
  executable lies in this install's `versions/`, and only while that PID still holds the lock), waits for the lock,
  and starts its own core. A core never replaces a newer one. The unit runs with `KillMode=process` (P-34), and a
  bridge that finds the unit restarting waits for it instead of starting a detached core.
- An E1 holder's session tells the client a new attach replaced with `detached { reason: attachedElsewhere }`, and
  its `attached` says no replay, as to a protocol 1 client, since the holder never sends `synced`.
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

**ST-23 Spikes S11 and S12** (R4, R5, R6, NFR-09)

- **S11 systemd.** A systemd test host on colima: a transient unit core with `Restart=on-failure`, holders in
  `systemd-run --user --scope`, lingering and `KillUserProcesses` detection, and what survives logout,
  `UserStopDelaySec` and `systemctl --user stop` in each P-32 variant.
- **S12 streamed snapshot.** Formatting rows in blocks through the formatter's selection and tracked grid
  references while output keeps arriving: consistency against a whole snapshot, peak memory at 100,000 lines.
- S13 (the port path) moved to ST-35, which measures the app anyway.
- Findings in `docs/spikes/S11.md` and `S12.md`.

As built (2026-11-14): S11 confirmed D-44 and showed why `KillUserProcesses=yes` hosts need the user manager; S12
confirmed block streaming and found that E1's snapshot drops the primary screen and its scrollback while a
full-screen program runs, which ST-25 fixes.

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

As built (ST-24 to ST-28, 2026-11-14):

- The holder streams snapshots in blocks of 256 rows from `trc-vt`'s `SnapshotStream`; while the alternate screen is
  active the primary screen and its scrollback come from a binary-snapshot copy, which fixes S12's E1 bug.
- A client queue over 1 MiB falls behind; it is resynced once 512 KiB of its credit is back. Input from one client
  tells the others at most once a second.
- The core replies to `attach` when the holder says `attached`; E1 holders keep one attachment and refuse `refresh`.
- Service mode: the bridge reads `loginctl`, `busctl` and `systemctl --user`; the unit is `trcd-<8 hex of the root's
SHA-256>.service` with `RestartPreventExitStatus=75 78` and the login umask; holders start through
  `systemd-run --user --scope`, falling back to a direct start.
- Upgrade: the bridge runs another installed binary, even for `--version`, only after the integrity check and its
  checksum pass, since the planted-daemon tests caught it running one that had not. `pnpm test:integration` upgrades
  the 0.2.0 release (`tools/test-hosts/fetch-old-daemon.sh`) with running sessions on a detached and a systemd host.
- The `update-app` failure is gone: an incompatible handshake says to update the app when the daemon is newer, and
  offers Upgrade daemon when it is older.

**ST-29 Automatic reconnect in the connection host** (US-2.2, NFR-07)

- The `reconnecting` state, the P-29 policy, retry now, stop retrying, network and wake triggers.

**ST-30 Reattach, resync and rebuild in the renderer** (US-2.1.3, US-2.2.2, A11Y-02.3, A11Y-03, A11Y-12)

- §3.3's terminal behavior; Reconnecting in the session tree and status bar; "Reconnected" shown and announced;
  Retry and Stop retrying per host.

As built (ST-29 and ST-30, 2026-11-14):

- A failed attempt while reconnecting reaches the renderer only as `reconnecting` with its failure, so retries raise
  no notification each time. A connection the user starts that fails before it ever connected is reported as in E1
  and not retried (US-1.3); the launch's connections (`restore`) and every host that has connected retry.
- The host's button tries again now while it reconnects, and retries after a failure ("Retry connecting to
  <host>"); Stop reconnecting is in its context menu and the palette. A lost host's connection steps are not
  announced; "Reconnected to <host>" is, and listed, and merges with "Connection to <host> lost" when the two come
  together.
- The output announcer holds speech from an attach or resync to its `synced` and the parse of what came before it,
  so no replayed line is spoken; a protocol 1 daemon keeps E1's rule (the first settled output is not spoken).
- A resync replaces the buffer once the output queued before it is parsed. Review mode and Find fetch the rows a
  screen resync skipped first; otherwise the gap fills 1 s after output pauses.

**ST-31 Restore at launch** (US-2.3, NFR-06)

- `sessions.json`, parallel connects, cached sessions shown as Reconnecting, failures that show their reason and
  retry.

As built (ST-31, 2026-11-14): `sessions.json` keeps each session's shell name too, which names a session without a
name or title; the cache follows the session list half a second after it settles, and a host the user disconnects
drops out of it. A restored host shows its cached sessions as Reconnecting until it lists its own; its terminals
refuse typing as "Reconnecting — input not sent" until they attach.

**ST-32 Shared sessions in the app** (US-2.6)

- P-31's size rule and indicator, the "Input from another client" announcement, and an e2e with a second client
  driven over ssh by the test.

As built (ST-32, 2026-11-14): a terminal sends a size only when the grid its frame fits changes, and not at all
while another client set the size; a size it asked for in the last 10 s counts as its own when the daemon reports
it. It takes the size back on focus or typing, and a reattach no longer sends its size while another client holds
it. "Input from another client" is announced in the open session when none came in the 3 s before. The e2e drives
the second client over its own ssh connection with the NFR harness's `LiveHost`.

**ST-33 Quitting** (US-2.1.1/4/5)

- "Quit and Stop All Sessions…", the first-quit dialog, and e2e checks that quit, crash and force-kill end no
  session.

As built (ST-33, 2026-11-14): the main process holds the first quit, from the menu, the shortcut or closing the
window, and asks the page, which quits at once when no session runs or shows the notice and marks it shown in
`config.json` (`quitNoticeShown`); a page that cannot answer within 2 s lets the app quit. The connection host
now stops on `will-quit`, so a held quit keeps every connection. Quit and Stop All Sessions sends `stop` with the
grace period Settings sets to each running session on each connected host and quits once all are done; e2e
launches start with the notice marked shown, except the test of the notice.

**ST-34 Hosts where sessions end at logout** (US-2.4.4)

- The host's status says sessions end when the last connection closes, and a warning precedes the first session
  created there.

As built (ST-34, 2026-11-14): the warning comes whenever a session is about to be created on such a host while
the host has none, from any of the ways to create one; Cancel creates nothing. An e2e runs on `trc-systemd-kill`.

**ST-35 NFR-02 on a sub-millisecond link** (S13)

- S13: where the 2.6 to 12 ms spread between the renderer and the connection host comes from; then the fix, and the
  UI test's local guard back at the PRD's 10 ms.

As built (ST-35, 2026-11-14): S13 found the spread in Chromium's `DeferRendererTasksAfterInput`, not in message
delivery; D-47 turns it off, and the UI test checks NFR-02 at 10 ms on both hosts ([S13](../spikes/S13.md)).

**ST-36 Soak and E2 verification** (NFR-11, NFR-06, NFR-07, NFR-09, NFR-12, S6)

- The P-25 soak: each cycle has every session print a marker while the host is disrupted, then checks that its shell
  keeps its PID, that the marker arrived, and that it still runs what is typed. A network flap stalls the app's ssh
  while the daemon still holds it, connects again and resumes every session from its offset: the replay must be a
  delta that shows the marker exactly once. NFR-06, NFR-07 and NFR-09 measured again. Results in
  `docs/verification/E2-nfr.md`.

As built (ST-36, 2026-11-15): every scenario lost 0 sessions, 1,000 cycles each, plus 50 logouts and 50 real app
quits and crashes; connecting again took 0.5 to 0.9 s at p95 ([E2-nfr](../verification/E2-nfr.md#soak-nfr-11-s6)).
NFR-02's UI test now compares with the link's own p95 round trip (P-35).

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
| ST-23 | Done    | —      |
| ST-24 | Done    | —      |
| ST-25 | Done    | —      |
| ST-26 | Done    | —      |
| ST-27 | Done    | —      |
| ST-28 | Done    | —      |
| ST-29 | Done    | —      |
| ST-30 | Done    | —      |
| ST-31 | Done    | —      |
| ST-32 | Done    | —      |
| ST-33 | Done    | —      |
| ST-34 | Done    | —      |
| ST-35 | Done    | —      |
| ST-36 | Done    | —      |
| ST-37 | Pending | —      |

## 8. Reviews (P-33)

Four rounds of `code-reviewer` and `technical-auditor` over every commit after v0.2.0. Every finding was fixed
test-first, or is listed below with why it stays. Findings that changed a behavior or an owner decision went to the
owner first; their answers are P-34.

| Round | Code review (C/H/M/L) | Audit (C/H/M/L) | Fixes                                                   |
| ----- | --------------------- | --------------- | ------------------------------------------------------- |
| 1     | 0 / 2 / 4 / 5         | 0 / 2 / 6 / 5   | `cdeeb8b`; owner decisions P-34(a)–(d)                  |
| 2     | 0 / 0 / 3 / 8         | 0 / 1 / 3 / 4   | `2690d02`; owner decision P-34(e)                       |
| 3     | 0 / 0 / 5 / 8         | 0 / 0 / 7 / 5   | `4946236`, and the soak harness in ST-36                |
| 4     | 0 / 0 / 2 / 9         | 0 / 1 / 3 / 3   | the ST-36 commit; the high was a seam name in a comment |

The highs:

- A snapshot's output between its screen block and `synced` was dropped (round 1).
- The renderer's credit leaked on resync and stale write callbacks granted to new streams (round 1).
- An E1 holder said `snapshot` but never sent `synced`, so speech stayed held in adopted sessions (round 1).
- The SEC-04.4 evidence cited tests that did not exist; they were written (round 1).
- The flap soak never dropped the connection; it now stalls ssh and resumes every session from its offset (round 2).
- A release bundle would have carried a test seam name in a comment, failing `verify:artifact`; a guard test now
  scans the app's source (round 4).

What stays, and why:

- `// SAFETY:` comments on `unsafe` blocks in `trc-vt` stay: they document each block's invariants, as Rust
  requires of `unsafe`, and are the one kind of comment beside doc comments.
- `stop_unit`'s 3 s bound and `recover`'s two call sites have no unit tests: they need a systemd user manager or an
  emulator that fails, which the systemd test hosts and the direct `recover` tests cover instead.
- A reconnect reattaches a session whose E1 holder another client opened while this one was away, as P-27 keeps E1's
  one-client behavior for those sessions until they close.
- On a host without lingering, the detached daemon keeps the user's login session `closing` after logout, so systemd
  keeps the user's manager running, as with tmux; the logout soak checks the logout itself and a detached core.

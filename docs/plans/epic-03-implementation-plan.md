# Epic 3 implementation plan: sessions that survive a host reboot

| Field  | Value                                                                                     |
| ------ | ----------------------------------------------------------------------------------------- |
| Status | Draft v1, decisions confirmed by the owner on 2026-11-16                                  |
| Owner  | Renato Oliveira                                                                           |
| Scope  | PRD §9.3 (US-3.1 to US-3.3) plus every global requirement for what E3 delivers            |
| Inputs | [PRD.md](../PRD.md) v0.16, [TECH_STACK.md](../TECH_STACK.md) v1.7, the E2 plan and v0.3.0 |

## 1. Context

E2 shipped as v0.3.0. Sessions outlive the app, the network, logouts where the host allows it, and daemon crashes
and upgrades, but a host reboot ends them, and the session list itself lives only in the running core: a new core
rebuilds it from its holders, in start order, so a restart already loses the user's order. What E3 adds:

- every session's metadata, scrollback and screen on disk, at most 5 s behind its output (NFR-08), readable only by
  the user (SEC-05);
- sessions that come back in a new shell, under a marker, after a reboot or any other loss of their processes;
- per-session control of what is restored and stored, and Clear scrollback;
- a host details view with the daemon's version, uptime, install path and logs, and Upgrade, Restart and Remove;
- the end of NFR-09's E2 exception (D-49);
- a bundle of UX changes the owner asked for (P-48).

E1's working agreement (E1 plan §3) and its autonomy rule (P-20) apply unchanged.

## 2. Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-38 | Story and decision numbers continue from the E2 plan (ST-38 onward, P-38 onward).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| P-39 | **Owner, 2026-11-16.** Nothing registers the daemon to start at boot: the app keeps writing nothing outside the install root (D-44), so a transient unit stays the core's unit. A rebooted host's sessions come back when the app next connects and the bridge starts the core, on every host. US-3.1.1 is amended to match. Recorded as D-48.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| P-40 | **Owner, 2026-11-16.** A starting core restores every session whose processes ended while it was running, unless the user stopped or closed it or turned its restore off: a host reboot, a logout that ended user processes, or a killed holder. The marker says "Session restored after restart on <date time>. Previous processes ended." when the boot ID changed, and "Session restored on <date time>. Previous processes ended." otherwise. Times are UTC, so the daemon needs no time zone data. D-48.                                                                                                                                                                                                                                                                                 |
| P-41 | **Owner, 2026-11-16.** Sessions that are not restored (exited or stopped before, or with restore off) stay in the list as they were, with their saved scrollback, until the user closes or restarts them; one that was running with restore off shows as ended by the restart.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| P-42 | **Owner, 2026-11-16.** A restored session carries a "Restored" badge in its name and description until it is opened on this Mac, as E5's event badges will. The app announces a restore once per host and restore: "devbox-1 restarted: 3 sessions restored", or "devbox-1: 1 session restored" when the host did not reboot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P-43 | **Owner, 2026-11-16.** The upgrade on connect stays (P-27, D-46). "Upgrade daemon" is enabled only when the host runs an older daemon than the app bundles, for example after a failed upgrade; otherwise the host says "Up to date".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| P-44 | **Owner, 2026-11-16.** US-3.2.2's setting is the checkbox "Save scrollback to disk", on by default, so no label is a double negative. Turning it off deletes the session's scrollback and screen from disk at once.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P-45 | **Owner, 2026-11-16.** After "Remove daemon from host", the host stays in the sidebar as "Daemon removed" and is not connected again, at launch either, until the user selects Connect, which installs the daemon again.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P-46 | **Owner, 2026-11-16.** Removal deletes everything TRC wrote: binaries, session data and logs. Only the entries TRC creates in the install root are deleted, then the root if it is empty, so a moved install location never loses other files.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| P-47 | **Owner, 2026-11-16, in place of P-37's plan.** A client that attaches while a full-screen program runs gets that program's screen; the holder sends it the shell's history and screen, streamed, when the program leaves the alternate screen. The app reads only the active buffer (review mode, find, the ATS, links), so nothing it shows is missing meanwhile. The primary-screen copy is deleted, which ends NFR-09's E2 exception without reading the disk, for sessions that save nothing too. Recorded as D-49.                                                                                                                                                                                                                                                                      |
| P-48 | **Owner, 2026-11-16, UX bundle.** (a) The terminal grid is at most 140 columns, up from 120. (b) Each session's state is a badge at the end of its row, with no state text: a filled circle for Running, half filled for Starting and Reconnecting, a hollow circle for Disconnected (the hosts' pattern), and a gray circle with a dash for Exited, Stopped and Failed to start; the state stays in the accessible name and the badge's tooltip. (c) Each session's name starts with the last two folders of its working directory, the home folder shown as `~` and counted as one folder. (d) The status bar's Tab focus mode and Mute toggle buttons become switches, and Notifications becomes an icon-only button that still shows the count. US-1.6 and US-1.9.3 are amended to match. |
| P-49 | Protocol 3 (N = 3). The daemon still accepts protocol 1 and 2 clients, and the core speaks holder protocols 1 to 3: an E1 or E2 holder keeps its behavior until its session closes (P-27), and the core records its session on disk from its `hello`, so it is restored, without scrollback, after a reboot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P-50 | A host reboot in the tests is `docker restart` of the test container: every process dies and the files stay. On the systemd hosts, systemd boots again and starts the lingering user manager, and the core starts only when the app connects (P-39). The detached hosts restart the same way.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P-51 | Review at the end of E3 as P-33 had it: `code-reviewer` (TypeScript, Rust) and `technical-auditor` (security, reliability, release) over every commit after v0.3.0, in rounds until no critical or high finding remains. A fix that would change the PRD, behavior, a design or an owner decision waits for the owner. The release workflow then cuts `v0.4.0` (`bump: minor`).                                                                                                                                                                                                                                                                                                                                                                                                               |

## 3. Design

### 3.1 On-disk layout (TECH_STACK §5.5, SEC-05, NFR-08)

`<root>/sessions/<id>/`, mode 0700, every file 0600:

- **`meta.json`**, written by the core: the holder spec (profile, cwd, environment overrides, size, scrollback
  limit), name, order, the two options of US-3.2, the state and exit status, `restoredAt`, and the boot ID it last
  ran under. Each write goes to a temporary file, is fsynced and renamed, and the directory is fsynced.
- **`history.log`**, written by the holder: append-only records `[u32 len][u32 crc32][VT bytes]`, one per batch of
  logical lines that left the screen, formatted unwrapped so a restore at another width reflows them. A tracked row
  marks the first line not yet written. `fdatasync` runs at most 2 s after a new record. When the log reaches twice
  the scrollback limit, the holder rewrites it from its emulator's history into a temporary file, then fsyncs and
  renames it. Recovery keeps the records before the first bad length or CRC.
- **`screen.vt`**, written by the holder: the primary screen, with its cursor and modes, rewritten (temporary file,
  fsync, rename) at most every 2 s while that screen changes. During a full-screen program the primary screen does
  not change, so the last copy, at most 2 s older than the program's start, is the one restored.
- A writer thread in the holder does all the file work, so the PTY read loop never waits for the disk (D-04). A
  write that fails (a full disk or quota, EIO) is retried every 10 s, and the holder reports `persistence: failing`
  with the reason until a write succeeds; the session keeps running.
- With "Save scrollback to disk" off, the holder writes neither file, and turning it off deletes both. "Clear
  scrollback" makes the holder put `CSI 3 J` into its output stream (its emulator, every client and the log) and
  truncate `history.log`. Closing a session deletes its directory once its holder exits.

### 3.2 Restore (US-3.1, P-39 to P-41)

A starting core:

1. adopts the live holders as in E2; a holder that is alive but silent keeps its session, which is never restored
   twice;
2. reads every `sessions/*/meta.json`; a directory whose `meta.json` is unreadable is kept, logged and skipped;
3. for each session without a live holder:
    - **restore**: it was running, the user had not stopped or closed it, and its restore option is on. A new holder
      feeds `history.log` and `screen.vt` into its emulator, writes the P-40 marker below them, and starts the
      shell with the same profile, arguments, environment overrides, size, name and position, in the last known
      working directory. If that folder is gone, the shell starts in the home folder, and a line below the marker
      says so (US-3.1.7). Nothing that ran in the shell runs again.
    - **keep**: anything else. A holder starts with the saved history and screen and no process, in the state it
      had; one that was running shows "Ended by restart" (P-41).
4. starts restores 4 at a time, so 100 sessions never start 100 shells at once, and serves the app meanwhile; each
   session reports Starting until its shell runs.

Every session in the registry is written to `meta.json`, so order, names and options also survive a core restart,
which E2 lost.

### 3.3 Holder protocol 3 and the alternate screen (P-47, P-49)

- `start` carries an optional `restore { historyPath, screenPath, marker, missingCwd }` and the US-3.2 options;
  `setOptions`, `clearScrollback` and the `persistence` status field are new.
- A full attach or refresh while the alternate screen is active sends the screen only, as a screen resync does, and
  marks the attachment as lacking history. When the alternate screen ends, every such attachment gets
  `resync { kind: full }`, streamed in blocks as in E2, then live output. The app's D-45 gap handling stops asking
  for the history while the session is on the alternate screen.

### 3.4 Daemon management (US-3.3, P-43, P-45, P-46)

- `welcome` adds the core's start time, install root, log folder and the account's home folder (the home folder
  comes first, in ST-39, as an optional protocol 2 field).
- **Host details** (the host's context menu, the hosts panel and the palette): connection, daemon version, uptime,
  service mode, install path and log location (both copyable), and Upgrade daemon, Restart daemon and Remove daemon
  from host….
- **Restart daemon** asks the core to stop. The holders keep running, the app reconnects at once, and the bridge
  starts a core that adopts them (the US-2.5 path).
- **Remove daemon from host…** lists the sessions that stop and the data that is deleted. The core stops every
  session with the stop grace period, deletes `sessions/`, stops its unit and exits. The app then runs the
  bootstrap's new `REMOVE` step over ssh, which ends any process whose executable lies in the root's `versions/`,
  deletes `versions/`, `run/` (and its `/tmp` fallback), `logs/` and the lock files, removes the root if it is empty,
  and reports what it left. The step also works when the core cannot be reached or speaks no common protocol.
- **Forget host** asks: Forget and leave sessions running, Stop sessions, remove the daemon and forget, or Cancel.

### 3.5 App

- **Restored sessions**: `restoredAt` per session from the daemon; `sessions.json` keeps the last `restoredAt` each
  session was opened with, which clears the badge (P-42). The announcement is polite and listed in Notifications.
- **Session settings…** (context menu, palette) and the New session… dialog show "Restore after restart" and "Save
  scrollback to disk". **Clear scrollback** is Command+K (free, and Terminal's key for it), the Edit menu, the
  palette and the terminal's context menu; it says "Scrollback cleared".
- **Persistence failures** show in the session's description and in host details, and are announced once.
- **UX bundle (P-48)**: the fitter's maximum becomes 140 columns; the row's state badge uses the hosts' icons plus a
  dashed ring, every color at least 3:1 against the sidebar (A11Y-07); the working-directory prefix is muted text
  before the name, inside the accessible name so Voice Control can say what is shown (WCAG 2.5.3), and type-ahead
  matches the prefix or the name; the status bar's switches are React Aria `Switch`es, and Notifications is an icon
  button named "Notifications, N" with its count drawn on it and a tooltip.

## 4. Stories

**ST-38 Plan and decisions**

- This plan; the PRD amendments of P-39 to P-48, v0.16; TECH_STACK D-48 and D-49, §5.5, the E3 rows of §10 and
  §11, v1.7; the doc-ID check reads this plan.
- Done when the doc-ID check passes and `docs(plan): ...` is committed.

**ST-39 UX bundle** (P-48, US-1.6, US-1.9.3, A11Y-05, A11Y-07, A11Y-11)

- The 140-column grid, the state badges, the working-directory prefix with `welcome.home`, the status-bar switches
  and the Notifications icon button. Component tests with axe, the contrast test for the new icon colors, e2e for
  the prefix as the shell changes folder, and `pnpm test:ax` for the switches' role and state.

As built (ST-39, 2026-11-16): `welcome` carries `details` (home, install root, log folder, start time) as an
optional protocol 2 field, so ST-47 needs no new handshake. The host keeps the last home folder it reported, so the
prefix stays while it is disconnected; cached sessions show none until their host connects. The state colors reuse
the success, warning, danger and muted text tokens, which the contrast test already holds to 4.5:1. The Settings
dialog and the status bar share one switch component. `pnpm test:ax` runs once at ST-50, since it takes focus.

**ST-40 Spike S7: persistence after a crash or power cut** (NFR-08, SEC-05)

- The writer against fault injection: truncation at every offset of a record, a torn last record, a bad CRC, a
  kill -9 during compaction and during a `screen.vt` rename; `docker restart` with sessions mid-flood; the lag
  between output and `fdatasync`; disk use per 10,000 lines; unwrapped lines restored at another width.
- Findings in `docs/spikes/S7.md`; §3.1 revised if they ask for it.

**ST-41 Protocol 3** (NFR-12, US-3.1, US-3.2, US-3.3)

- `PROTOCOL_VERSION` 3, minimum 1: `restoredAt`, the session options, the ended-by-restart exit, `persistence`,
  options on `create`, `setSessionOptions`, `clearScrollback`, `restartDaemon`, `removeDaemon`, and the `welcome`
  fields. Fixtures `v3`; ts-rs and zod. Holder protocol 3 (§3.3).

**ST-42 Holder persistence** (US-3.1.2, US-3.2, NFR-08, SEC-05)

- §3.1 in the holder: the writer thread, `history.log`, `screen.vt`, compaction, recovery, the options, Clear
  scrollback, failure reports. Unit tests per file format; integration tests in the containers.

**ST-43 History at program exit** (NFR-09, D-49)

- §3.3's alternate-screen rule, the primary copy deleted, the app's gap handling; the NFR-09 test asserts that a
  full attach during a full-screen program adds under 10 MiB at 100,000 lines.

As built (ST-43, 2026-11-16): the attach says nothing of the missing history, so the app needed no change: a client
that joined during the program, or asked for `refresh` then, gets an unsolicited `resync { kind: full }` the moment
the program leaves the alternate screen, which the app already handles as a rebuild; a protocol 1 client gets a
reset and the whole snapshot. The NFR-09 test also measures the holder while that history streams.

**ST-44 Core: session store and restore** (US-3.1, US-3.2.1, US-2.5)

- `meta.json` for every session, adopted E1 and E2 holders included; §3.2's restore and keep; the marker; boot ID
  detection; the missing-folder fallback. Integration tests: a restart of every test host with sessions on the
  primary and alternate screens, a killed holder, restore off, scrollback off, and a 0.3.0 session restored without
  scrollback.

**ST-45 Restored sessions in the app** (US-3.1.6, A11Y-12)

- The badge until opened, the per-host announcement, the marker in review mode; e2e across a test-host restart.

**ST-46 Session settings and Clear scrollback** (US-3.2, SEC-05.2)

- The two checkboxes in New session… and Session settings…, Clear scrollback and its key binding
  (`docs/design/keymap.md`), persistence failures shown and announced.

**ST-47 Host details and daemon management** (US-3.3.1–3, SEC-07, SEC-08)

- §3.4's details view, Upgrade, Restart, Remove with the bootstrap's `REMOVE` step, and "Daemon removed" hosts that
  are not connected again (P-45). Tests that removal leaves nothing TRC wrote and keeps a foreign file in a moved
  root.

**ST-48 Forget host and manual removal** (US-3.3.4–5)

- The three-way Forget dialog; USER_GUIDE sections on what is saved, restore, and manual removal from a Linux host
  and from the Mac; the in-app guide rendered again.

**ST-49 E3 verification** (NFR-08, NFR-09, NFR-05, NFR-06, NFR-11)

- NFR-08 measured (the largest lag between output and its `fdatasync` over a flood), NFR-09 without the copy, and
  NFR-05 and NFR-06 again with persistence on. A reboot soak: 100 restarts of a test host with sessions that print
  a marker, each checking that every session is restored exactly once with its marker. The E2 soak scenarios run
  again with persistence on. Results in `docs/verification/E3-nfr.md`.

**ST-50 Release gate, reviews and v0.4.0** (PRD §9 done)

- The full suites; `docs/verification/E3-manual-at.md` and `E3-security.md` (SEC-05 now holds data); the P-51
  reviews; final pass over CLAUDE.md, README, USER_GUIDE, TECH_STACK and PRD, with NFR-09's exception marked
  resolved; release `v0.4.0`.

## 5. Traceability

| PRD item | Stories                    | PRD item       | Stories                  |
| -------- | -------------------------- | -------------- | ------------------------ |
| US-3.1   | ST-40–ST-42, ST-44, ST-45  | NFR-08         | ST-40 (S7), ST-42, ST-49 |
| US-3.2   | ST-41, ST-42, ST-44, ST-46 | NFR-09         | ST-43, ST-49             |
| US-3.3   | ST-41, ST-47, ST-48        | NFR-05, NFR-06 | ST-49                    |
| SEC-05   | ST-42, ST-46, ST-50        | NFR-11, NFR-12 | ST-41, ST-49             |
| US-1.6   | ST-39                      | US-1.9         | ST-39, ST-45             |

## 6. Human checkpoints

| When  | The owner does                                                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| ST-39 | Optional: look at the new session rows, status bar and 140-column grid in a development build.                                      |
| ST-50 | Decide any review finding whose fix would change the PRD, behavior, a design or an owner decision; test the build; accept the gate. |

## 7. Status

| Story | Status  | Commit |
| ----- | ------- | ------ |
| ST-38 | Done    | —      |
| ST-39 | Planned | —      |
| ST-40 | Planned | —      |
| ST-41 | Planned | —      |
| ST-42 | Planned | —      |
| ST-43 | Planned | —      |
| ST-44 | Planned | —      |
| ST-45 | Planned | —      |
| ST-46 | Planned | —      |
| ST-47 | Planned | —      |
| ST-48 | Planned | —      |
| ST-49 | Planned | —      |
| ST-50 | Planned | —      |

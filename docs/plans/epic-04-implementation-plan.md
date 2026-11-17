# Epic 4 implementation plan: local sessions on the Mac, and macOS hosts

| Field  | Value                                                                                         |
| ------ | --------------------------------------------------------------------------------------------- |
| Status | Approved by the owner on 2026-11-17                                                           |
| Owner  | Renato Oliveira                                                                               |
| Scope  | PRD §9.4 (US-4.1 to US-4.5) plus every global requirement for what E4 delivers                |
| Inputs | [PRD.md](../PRD.md) v0.17, [TECH_STACK.md](../TECH_STACK.md) v1.7, the E1 to E3 plans, v0.4.0 |

## 1. Context

E3 shipped as v0.4.0: sessions on Linux hosts outlive the app, the network, daemon crashes and upgrades, and come
back after a reboot below their saved scrollback. The Mac itself runs no sessions, and Macs cannot be hosts. What E4
adds:

- a macOS `trcd`, one universal2 binary for the Mac's own daemon and for remote Macs (TECH_STACK §5.1);
- "This computer" first in the sidebar, whose daemon the app installs and registers as a LaunchAgent on first launch,
  with no administrator password (US-4.1);
- local sessions with every E1–E3 capability (US-4.2), that outlive the app and the daemon (US-4.3) and come back
  after a reboot, and survive a logout (US-4.4);
- macOS hosts over SSH, arm64 and x86_64, as a LaunchAgent where the user has a GUI login and detached otherwise
  (US-4.5, R7).

E1's working agreement (E1 plan §3) and its autonomy rule (P-20) apply unchanged.

## 2. Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-54 | Story and decision numbers continue from the E3 plan (ST-51 onward, P-54 onward).                                                                                                                                                                                                                                                                                                                                                                                          |
| P-55 | **Owner, 2026-11-17.** The daemon registers as a plain per-user LaunchAgent: a plist in `~/Library/LaunchAgents` that runs the installed `versions/<sha256>/trcd`, loaded with `launchctl bootstrap gui/<uid>`. No step needs an administrator, and it works on 0.x's ad-hoc signed builds. SMAppService (TECH_STACK §5.4), which Electron documents as reliable only for signed and notarized apps, waits for E8's Developer ID signing.                                  |
| P-56 | **Owner, 2026-11-17.** The Mac's local daemon uses `~/.trc`, the default install root, beside the app's own files (`config.json`, `hosts.json`, `sessions.json`). So one daemon per user serves both the Mac's own sessions and any other computer that adds the Mac as a host (US-4.5.3). Remove daemon deletes only the daemon's entries (P-46).                                                                                                                         |
| P-57 | **Owner, 2026-11-17.** macOS hosts for the integration and e2e tests are local macOS VMs run with `tart` (Apple's Virtualization framework). Every VM is deleted after its run, and the base image at the end of E4, so the disk gets its space back; the colima profile's unused images and build cache were pruned at the same time.                                                                                                                                     |
| P-58 | **Owner, 2026-11-17.** Tests on the owner's Mac that need launchd register temporary agents labelled `dev.trc.test-<random>`, each running a scratch install root, and boot them out and delete their plists afterwards. They never touch the real agent or `~/.trc`.                                                                                                                                                                                                      |
| P-59 | The local connection is the remote one without `ssh`: the connection host runs the same bootstrap script with `/bin/sh` and talks to `trcd bridge` over its standard input and output. Install, upgrade on connect (D-46), Restart, Remove and every protocol path are shared, and nothing listens (SEC-01).                                                                                                                                                               |
| P-60 | A LaunchAgent's label is `dev.trc.trcd-<hash8>`, the first 8 hex digits of the install root's SHA-256, as the systemd unit is `trcd-<hash8>.service`. It sets `RunAtLoad` (start at login, US-4.4.1), `KeepAlive` on a crash (US-4.3.2), `AbandonProcessGroup`, and the install root's `logs/` for its output. Holders already call `setsid()`, so stopping the agent never ends them (R4).                                                                                |
| P-61 | On a remote Mac the bridge registers the LaunchAgent only when the user has a GUI login session (`gui/<uid>` exists); otherwise the core runs detached, as on Linux, and after a reboot without a GUI login its sessions come back when the app reconnects (US-4.5.2, R7). This is the one place where TRC writes outside the install root, as the PRD asks; Remove daemon boots the agent out and deletes its plist.                                                      |
| P-62 | **Owner, 2026-11-17, after S8.** A logout ends the agent's core but no holder, as holders called `setsid()`: the next core, started by the agent at the next login or by a connection, adopts them, so a logout ends no session (US-4.4.2, amended in PRD v0.18). Only a reboot respawns shells, and the boot ID tells the two apart.                                                                                                                                      |
| P-63 | x86_64 Macs run the universal2 binary's x86_64 slice. The tests run it under Rosetta in the arm64 VMs and natively on the `macos-15-intel` CI runner; the app's x64 build bundles the same binary.                                                                                                                                                                                                                                                                         |
| P-64 | Review at the end of E4 as P-51 had it: `code-reviewer` and `technical-auditor` over every commit after v0.4.0, in rounds until no critical or high finding remains. A fix that would change the PRD, behavior, a design or an owner decision waits for the owner. The release workflow then cuts `v0.5.0`.                                                                                                                                                                |
| P-65 | **Owner, 2026-11-17.** Two usability changes ship in 0.5.0 (ST-61). Cmd+W, Session > Close Session, closes the open session whatever its state, through US-1.10.4's confirmation, which stays; Windows and Linux will bind Ctrl+Shift+W, as Ctrl+W is the shell's delete-word and a control code (A11Y-05.5). An ended session's terminal shows a banner at its top that says why it ended, with Restart and Remove on its right; Remove opens the same confirmation.      |
| P-66 | **Owner, 2026-11-17, after S8.** Under the LaunchAgent, macOS asks once per protected folder (Desktop, Documents, Downloads, removable and network volumes) whether `trcd` may read it, and the command waits for the answer; with 0.x's ad-hoc signatures each daemon version is likely asked again. 0.x accepts this: the user guide explains the prompt and how to grant Full Disk Access instead, and E8's Developer ID signing makes the answer last across versions. |
| P-67 | The macOS test VM runs on lima's user-mode network (`limactl usernet`, gVisor) through `tart run --net-fd`, as tart's shared NAT gets no DHCP lease on a managed Mac whose packet filter drops the VM's frames (S8). The VM's SSH port is forwarded to `127.0.0.1` only, so nothing else reaches it; its users sign in with the run's test key, and password logins are turned off once that key is in place.                                                              |

## 3. Design

### 3.1 The macOS daemon (TECH_STACK §5.1, §5.4)

- `ghostty-vt-sys` builds libghostty-vt for `aarch64-macos` and `x86_64-macos` with Zig; `pnpm build:daemon` builds
  `trcd` for both Apple targets and joins them with `lipo` into `resources/daemon/darwin-universal/trcd`, beside
  the Linux binaries, with its SHA-256 in the manifest. It is ad-hoc signed, which arm64 requires.
- Linux-only code stays behind `cfg(target_os = "linux")`; macOS gets its own:
    - the working folder from `proc_pidinfo(PROC_PIDVNODEPATHINFO)`, then OSC 7;
    - the boot ID from `sysctl kern.bootsessionuuid`;
    - the account from `getpwuid_r`, as `dscl` is not needed;
    - peer credentials from `getpeereid`, as today;
    - the service mode from `launchctl print gui/<uid>`: a LaunchAgent where a GUI login session exists, else
      detached.
- The bootstrap script learns Darwin: `uname -m` maps `arm64` and `x86_64` to the universal binary; `shasum -a 256`
  is the checksum tool; there is no `/proc`, so finding this install's processes uses `ps -axo pid=,comm=`; the
  account comes from `id` rather than `getent`; and `REMOVE` boots out the agent before it deletes anything.

### 3.2 launchd service mode (P-55, P-60, P-61)

- The bridge, finding no core, writes `~/Library/LaunchAgents/dev.trc.trcd-<hash8>.plist` (mode 0600, holding no
  secret) and runs `launchctl bootstrap gui/<uid>` on it, then waits for the core's socket; an agent already loaded
  is kickstarted, or replaced when its plist changed. A failure to register falls back to a detached core, which the
  daemon details then show.
- An upgrade (D-46) boots the old agent out, and the new bridge writes the plist for the new
  `versions/<sha256>/trcd` and bootstraps it; holders, in their own sessions, keep running, and the new core adopts
  them.
- Restart daemon ends the core with status 0, which `KeepAlive` leaves stopped, and the next bridge kickstarts the
  agent; Remove daemon is `bootout`, then the plist's deletion, then E3's removal.
- Welcome's service info gains `launchd`; the details say "As a LaunchAgent, which starts at login".

### 3.3 This computer (US-4.1, US-4.2, P-56, P-59)

- The app adds a host entry `local`, first in the sidebar and named "This computer", that can't be forgotten; its
  connection skips every SSH step and runs the bootstrap locally with the bundled `darwin-universal/trcd`.
- At launch, and whenever its daemon is missing, the app installs and starts it; progress is shown and announced as
  for a remote host (US-1.4.5), and a failure names its cause and next step.
- Everything else, from New session (with the login shell as its default) to restore and sharing, is the remote
  path unchanged. NFR-01 is measured on it.
- Test builds point the local host at `TRC_HOME`'s scratch root and a test label (P-58).

### 3.4 macOS hosts (US-4.5, P-57, P-63)

- `tools/test-hosts/macos/` gets `up.sh` and `down.sh`: `up.sh` clones a tart VM from the pinned macOS base image,
  starts it on lima's user-mode network with its SSH port on `127.0.0.1` (P-67), installs Rosetta, and signs in two
  users with the run's test key: `admin`, whom the image logs in to the GUI at boot, and `trcnogui`, who never has a
  GUI login. It turns password logins off and adds both to the test SSH config; `down.sh` deletes the VM; `--purge`
  also deletes the image.
- The integration and e2e suites gain `trc-mac-gui` (LaunchAgent) and `trc-mac-nogui` (detached) when the VM runs,
  and skip otherwise, as the Linux hosts do. A VM reboot is the macOS host restart; the x86_64 slice runs under
  Rosetta there (P-63).

### 3.5 What S8 found ([S8](../spikes/S8.md))

- **launchd and holders.** `bootout`, `kickstart -k` and a killed core end no holder, and the next core adopts every
  one, on this Mac and in the VM (R4).
- **Logout** ends the agent's core, not the sessions (P-62). **Reboot** with a GUI login: the agent starts the core
  at login, which respawns every session before the app connects; without one, the next connection does (R7).
- **Privacy prompts** come for sessions under the agent, attributed to `trcd` (P-66); detached cores and SSH get
  none.
- **The universal binary** is 6.2 MiB; both slices and libghostty-vt target macOS 13.0, which covers PRD §7.2's
  current and previous two releases; the x86_64 slice runs under Rosetta. Stock Macs have no `lipo`, so the
  bootstrap never calls it.
- **Under `KeepAlive`** a core that exits non-zero restarts every 10 s, so under launchd a core refused for another
  core (75) or an untrusted install (78) must not loop (ST-54).

## 4. Stories

**ST-51 Plan and decisions**

- This plan; TECH_STACK: D-50 (the plain LaunchAgent, P-55), D-51 (the shared root, P-56), D-52 and tart 2.42 as a
  development tool (P-57), the E4 rows of §10 and §11, v1.8; the doc-ID check reads this plan.
- Done when the doc-ID check passes and `docs(plan): ...` is committed.

**ST-52 Spike S8: launchd, holders and macOS hosts** (R4, R5, R7 on macOS)

- On this Mac with temporary agents (P-58): `bootstrap`, `bootout`, `kickstart -k` and `kill -9` of the core against
  holders that called `setsid()`; the agent's `RunAtLoad` and `KeepAlive`.
- In a tart VM: logout and reboot of a GUI user; a detached core for a user without a GUI login; privacy prompts
  (§3.5); the universal2 binary's size and the x86_64 slice under Rosetta.
- Findings in `docs/spikes/S8.md`; §3 revised if they ask for it.

**ST-53 macOS daemon** (US-4.2, US-4.5.1, NFR-09, NFR-10)

- §3.1: the universal2 build, the macOS working folder, boot ID, account and service detection; the bootstrap's
  Darwin support. Native unit and integration tests; the `macos-15` and `macos-15-intel` CI jobs.

**ST-54 launchd service mode** (US-4.1.1, US-4.3, US-4.4, US-4.5.2)

- §3.2: the plist, bootstrap, upgrade, Restart, Remove and the fallback; tests with temporary agents (P-58).

**ST-55 This computer** (US-4.1, US-4.2, A11Y-12)

- §3.3 in the connection host, main process and renderer; e2e with a scratch root and a test label.

**ST-56 Local sessions outlive the app and the daemon** (US-4.3, US-4.4)

- App quit, crash, force-kill and update; the daemon killed and upgraded; logout and reboot in the VM.

**ST-57 macOS hosts** (US-4.5)

- §3.4's test hosts, then every E1–E3 integration and e2e path on `trc-mac-gui` and `trc-mac-nogui`; a Mac's local
  sessions seen from a second app (US-4.5.3).

**ST-58 Docs**

- USER_GUIDE: This computer, macOS hosts, what runs at login, and removing TRC by hand on macOS (US-3.3.5); README,
  CLAUDE.md commands for the macOS test hosts.

**ST-59 E4 verification** (NFR-01, NFR-05, NFR-09, NFR-11)

- NFR-01 on local sessions; NFR-05 and NFR-09 on the macOS daemon; a soak of daemon kills and upgrades under launchd
  with a temporary agent, and of app quits and crashes on local sessions. Results in `docs/verification/E4-nfr.md`.

**ST-60 Release gate, reviews and v0.5.0** (PRD §9 done)

- The full suites; `E4-manual-at.md` and `E4-security.md`; the P-64 reviews; the VM and its image deleted (P-57);
  release `v0.5.0`.

**ST-61 Close shortcut and the ended-session banner** (US-1.10.4, US-1.10.8, US-1.10.9, A11Y-05, A11Y-11, P-65)

- The `session.close` command with Cmd+W in the keymap, `docs/design/keymap.md` and the Session menu; the banner in
  the terminal view, announced when the open session ends; the PRD's US-1.10 gains both; USER_GUIDE.

## 5. Traceability

| PRD item | Stories             | PRD item       | Stories      |
| -------- | ------------------- | -------------- | ------------ |
| US-4.1   | ST-54, ST-55        | NFR-01         | ST-55, ST-59 |
| US-4.2   | ST-53, ST-55        | NFR-05, NFR-09 | ST-53, ST-59 |
| US-4.3   | ST-52, ST-54, ST-56 | NFR-11         | ST-59        |
| US-4.4   | ST-52, ST-54, ST-56 | SEC-01, SEC-02 | ST-55, ST-60 |
| US-4.5   | ST-52, ST-53, ST-57 | R4, R5, R7     | ST-52        |
| US-1.10  | ST-61               |                |              |

## 6. Human checkpoints

| When  | The owner does                                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------ |
| ST-51 | Approve this plan; allow `brew install cirruslabs/cli/tart` and the macOS base image (about 25 GB) for P-57.       |
| ST-52 | Decide the privacy-prompt remedy if S8 finds the prompts bothersome (§3.5).                                        |
| ST-60 | Decide any review finding whose fix would change the PRD, behavior, a design or an owner decision; test the build. |

## 7. Status

| Story | Status  | Commit  |
| ----- | ------- | ------- |
| ST-51 | Done    | 661c3ba |
| ST-52 | Done    | f3e8ad6 |
| ST-53 | Done    | ba2bb09 |
| ST-54 | Done    | 64cccdd |
| ST-55 | Done    | d39645d |
| ST-56 | Planned | —       |
| ST-57 | Planned | —       |
| ST-58 | Planned | —       |
| ST-59 | Planned | —       |
| ST-60 | Planned | —       |
| ST-61 | Done    | —       |

# Epic 6 implementation plan: Windows desktop

| Field  | Value                                                                                                                                                          |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status | Approved by the owner on 2026-11-21                                                                                                                            |
| Owner  | Renato Oliveira                                                                                                                                                |
| Scope  | PRD §9.6 (US-6.1 to US-6.3) plus every global requirement for what E6 delivers, in two releases (P-85)                                                         |
| Inputs | [PRD.md](../PRD.md) v0.19, [TECH_STACK.md](../TECH_STACK.md) v1.10, the E1 to E5 plans, v0.6.1, [E6-windows-bringup.md](../verification/E6-windows-bringup.md) |

## 1. Context

E5 shipped as v0.6.0 and its host-key fix as v0.6.1. Before this plan, the owner had every default build and test flow
run on Windows (D-59 to D-64, `E6-windows-bringup.md`): `pnpm install`, `pnpm check`, the builds, `pnpm dist` and the
Linux daemons pass on Windows 11 x64, and libghostty-vt builds and passes for MSVC. The owner's own Windows workflow,
NVDA and JAWS plus Magnifier's read aloud, is what E6 is for.

E6 ships in two alpha releases (P-85):

- **0.7.0, the Windows app against Linux and macOS hosts (US-6.1).** Windows OpenSSH, Windows conventions, the
  Accessible Text Surface through UI Automation, installers, and the test tooling on Windows.
- **0.8.0, local Windows sessions (US-6.2) and command-aware PowerShell (US-6.3).** `trcd` on Windows: named pipes,
  ConPTY holders outside every job object, per-user auto-start, then PowerShell's shell integration.

What exists:

- the app builds, packages and opens on Windows, with no This computer;
- the protocol, the connection host's reducers, the ATS and the announcer, all OS-independent;
- `windows-sys` and the ConPTY plan in TECH_STACK §5.4 and §5.6, and the Windows profiles in §8.

What is missing (bring-up §"For the E6 plan"):

- **SSH.** The connection host spawns `/usr/bin/ssh`, and its `askpass` and `known-hosts` helpers are sh scripts,
  which Windows OpenSSH can't run. Git's OpenSSH 8.8 comes first on PATH on the owner's machine. The OpenSSH agent
  service is disabled, as Windows ships it.
- **Windows conventions.** The menu bar is macOS's (an app menu named after the product). The keymap is macOS's
  only. Copy last command output joins lines with LF while xterm.js copies with CRLF.
- **Assistive technology on Windows.** Nothing has checked the ATS through UI Automation or IAccessible2. Magnifier's
  read aloud isn't in the PRD's AT matrix (§7.3).
- **Privacy at rest.** The TRC home relies on the profile's ACL.
- **Packaging.** An unsigned x64 zip only (D-63).
- **Tests.** `tools/test-hosts` is sh and colima, `pnpm test:ax:mac` is a Swift probe of macOS's AX API, and nothing
  live has run on Windows.
- **The daemon.** `trcd` does not compile for Windows: 114 errors, from Unix sockets, rustix PTYs, processes and
  files, and Unix signals.

E1's working agreement (E1 plan §3) and its autonomy rule (P-20) apply unchanged. This PC is the owner's: tests kill
processes only by patterns under their scratch roots, and nothing logs the owner out, reboots or starts a screen
reader without warning them first.

## 2. Decisions

| ID    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-84  | Story and decision numbers continue from the E5 plan (ST-74 onward, P-84 onward). S9 is 0.7.0's spike, re-scoped: libghostty-vt on MSVC was done in the bring-up, and the ConPTY holder moves to S15, 0.8.0's spike.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| P-85  | **Owner, 2026-11-21.** E6 ships as two alpha releases: 0.7.0 is US-6.1, the Windows conventions and Windows packages; 0.8.0 is US-6.2 and US-6.3. E7 becomes 0.9.0, and 1.0.0 stays E8's (D-43). Until 0.8.0 the Windows app shows no This computer, and says local sessions arrive in a later release.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| P-86  | **Owner, 2026-11-21.** Copy and paste on Windows are strict: Ctrl+Shift+C and Ctrl+Insert copy, Ctrl+Shift+V and Shift+Insert paste, and Ctrl+C and Ctrl+V always reach the shell. Ctrl+C copying while a selection exists becomes a setting, off by default, since a selection a screen reader or magnifier user can't see would turn an interrupt into a copy. This amends A11Y-04.6, which had Ctrl+C copy by default on Windows and Linux; Linux follows in E7, as GNOME Terminal is strict too.                                                                                                                                                                                                                                                                                                                                                          |
| P-87  | **Owner, 2026-11-21.** Windows packages for x64 and arm64, each a per-user NSIS installer and a zip, unsigned until E8's Authenticode (SEC-04.1). The installer needs no administrator rights, installs into `%LOCALAPPDATA%\Programs\TRC` and adds a Start menu shortcut with the app's AppUserModelID, which Windows notifications need (US-5.3). They are built and verified in GitHub Actions only, x64 on `windows-2025` and arm64 on `windows-11-arm`; arm64 is tested on that runner alone. Supersedes D-63.                                                                                                                                                                                                                                                                                                                                           |
| P-88  | **Owner, 2026-11-21.** The automated checks (PRD §11.2) gate 0.7.0 and 0.8.0, as P-83 had it for 0.6.0. `E6-manual-at.md` scripts every Windows cell: JAWS and NVDA, current and previous, Narrator, Magnifier with read aloud, Voice Access and Voice Typing. Those passes run at a later gate, before 1.0.0. Magnifier's read aloud joins PRD §7.3's Windows read-aloud cell beside Narrator: Ctrl+Alt+Enter reads the selection, and Ctrl+Alt+click reads from the pointer. A11Y-04.2 and A11Y-06 name it.                                                                                                                                                                                                                                                                                                                                                 |
| P-89  | Windows OpenSSH (US-6.1.2): `%SystemRoot%\System32\OpenSSH\ssh.exe` by absolute path, never an ssh found on PATH, with `ssh-keygen` and `ssh-add` from the same folder for US-1.3's checks. `ssh -V` must report 8.5 or newer, as on macOS (this PC has 9.5p2). The agent is Windows' own (the `openssh-ssh-agent` pipe), or whatever `SSH_AUTH_SOCK` names. When the agent service is disabled, as Windows ships it, the failure says so and how to turn it on. That takes an administrator, so the app never does it (SEC-07).                                                                                                                                                                                                                                                                                                                              |
| P-90  | The helpers on Windows are `trcd.exe askpass` and `trcd.exe known-hosts`, as TECH_STACK §4.5 planned: the sh scripts' behavior, notices behind the nonce on stderr and every secret refused. 0.7.0 builds `trcd.exe` for Windows with only these subcommands and `--version`; the daemon modules compile for Unix only until ST-86. S9 checks how Windows ssh starts each helper, paths with spaces and non-ASCII names, and that no console window flashes for ssh or a helper. The answer may make `trcd.exe` a Windows-subsystem binary, which 0.8.0's core, started at login, needs anyway.                                                                                                                                                                                                                                                               |
| P-91  | D-58's discarding known_hosts check also counts `NUL`, in any case, and whatever S9 finds `ssh -G` reports on Windows for `/dev/null`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| P-92  | Windows conventions (US-6.1.3, A11Y-05, A11Y-11). **Window:** a native title bar and menu bar, so UI Automation, Narrator and Voice Access see native menus. **Menus:** File (the Session menu's items, Settings, Exit), Edit, View, Terminal and Help (the user guide, Accessibility help, About). **Menu bar keys:** F10 and a lone Alt press reach it, mnemonics work outside the terminal, and in the terminal Alt+letter stays the shell's Meta. **Copy:** every copy puts CRLF line breaks on the clipboard; paste still sends CR. **AltGr:** Ctrl+Alt is AltGr on many layouts, so the characters it types reach the shell as text.                                                                                                                                                                                                                    |
| P-93  | The Windows keymap follows keymap.md's rules, with Windows' reserved keys. **Never used:** Control+letter (rule 3), Alt+letter (menus and Meta), any Control+Alt chord (AltGr, and Magnifier's modifier), the Windows key, and NVDA's and JAWS' Insert and Caps Lock chords. **Command becomes Control+Shift**, as Windows Terminal binds its commands. Alt+F1 is Accessibility help and Alt+F2 review mode, the PRD's proposals, and Ctrl+Shift+W closes a session (P-65). The Option+Command commands get their own chords in ST-78. keymap.md gains the Windows table, and a test checks it against `keymap.ts`.                                                                                                                                                                                                                                           |
| P-94  | Privacy at rest on Windows (SEC-02, SEC-05: user-only access control lists). The TRC home and the app's log folder get a protected DACL that grants only the user's SID, with inheritance from above turned off. It is set at creation and checked at launch. They are also marked not content indexed, so Windows Search never indexes state or scrollback. The bundled `trcd.exe` applies it through `windows-sys`, the same code 0.8.0's daemon root uses.                                                                                                                                                                                                                                                                                                                                                                                                 |
| P-95  | Windows state files: `JsonStore` retries a rename that fails on a sharing violation (an antivirus or the indexer holding the file) for up to 1 s, then reports the failure (bring-up item 10). `TRC_HOME` accepts `~\` (item 9).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| P-96  | Test hosts on Windows. `tools/test-hosts`' sh scripts become TypeScript (D-60), driving colima on macOS and Docker Desktop's WSL 2 engine on Windows from the same `compose.yaml`, SSH on `127.0.0.1` only. The Windows app's integration, e2e, NFR and app soak suites run on this PC against them. **To confirm:** macOS hosts are not tested from Windows. The tart VM listens on the Mac's loopback only (P-57), and every Windows-specific part (ssh, helpers, app) is shared with Linux hosts, so the Mac's suites keep US-4.5. GitHub's Windows runners can't run Linux containers, so CI on Windows runs the unit gate, the builds and the packages.                                                                                                                                                                                                  |
| P-97  | Accessibility tree checks on Windows (PRD §11.2). `tools/uia-probe`, a Rust command-line tool on the `windows` crate's UI Automation bindings, reads the focused element's control type, name, TextPattern selection, caret range and bounding rectangles. Swift's `ax-probe` is macOS-only, and Python is ruled out. `pnpm test:ax:win` runs the ax suite with it. It takes focus, so the owner is warned first. NFR-04 on Windows is measured with Narrator on, since Narrator ships with Windows and can be started by a script; JAWS and NVDA wait for P-88's passes.                                                                                                                                                                                                                                                                                     |
| P-98  | Test launches on Windows open unseen, as D-27 has it on macOS: shown inactive, fully transparent, click-through, kept off the taskbar and in the bottom-right corner, never focused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| P-99  | The Windows daemon (0.8.0, US-6.2.5, SEC-01, SEC-02). One `trcd` source, with the platform parts behind `cfg`. **Pipes:** the core's `\\.\pipe\trc-<hash of user SID and root>-core` and one per holder. Each pipe is the first instance, rejects remote clients, has a DACL that grants only the user, and its peers are checked by process token SID both ways (TECH_STACK §5.6). **One core:** `LockFileEx` on `run/core.lock` replaces `flock`. **Holders:** each owns its pseudoconsole through Microsoft's redistributable `conpty.dll` and `OpenConsole.exe` (MIT, pinned and verified). They start with `CREATE_BREAKAWAY_FROM_JOB` and `DETACHED_PROCESS`, and keep their shell's processes in a job object of their own, so Stop ends the whole tree. **Files:** syncs use `FlushFileBuffers`, and replacements use `MoveFileEx` with P-95's retry. |
| P-100 | Start and auto-start (US-6.2.1, R4, R5). **At login:** per user, without administrator rights. S15 picks the `HKCU\…\Run` value, visible and switchable in Settings' startup apps, unless S15 finds a per-user Task Scheduler logon task (no time limit) does better. **Breakaway refused:** when the app runs inside a job that forbids breakaway, the bridge starts the core through that registration, which runs outside the app's job. **After a crash:** the next bridge starts a core, as with the detached Linux core, while holders keep the sessions (US-2.5). **Logout and reboot** end holders; the core started at the next login restores them (US-6.2.3, as US-4.4).                                                                                                                                                                           |
| P-101 | This computer on Windows (US-6.2.2, US-6.2.4). **Install and reach:** first in the sidebar, its daemon in `%USERPROFILE%\.trc` (D-51), reached by starting `trcd.exe bridge` directly, and installed and upgraded as a host's is (D-46). Stopping an older core is a request over its pipe, then `TerminateProcess` only while that process still holds the lock. **Profiles:** TECH_STACK §8's pwsh, Windows PowerShell 5.1, cmd and WSL distributions; the default is pwsh when installed, else Windows PowerShell. **Environment:** each shell's comes from the user's token (`CreateEnvironmentBlock`), never the daemon's, plus §8's variables. **Stop:** closing the pseudoconsole sends the close request, and after the grace period the session's job is terminated.                                                                                 |
| P-102 | Shell integration on Windows (US-6.3). **PowerShell:** pwsh and Windows PowerShell 5.1, locally and on remote hosts with pwsh, get TRC's own `trc.ps1`. It emits OSC 133 A to D with the exit status, and OSC 7, by wrapping the user's `prompt` and PSReadLine's Enter handler. It loads with `-NoExit -Command`, dot-sourced from the script folder. Windows PowerShell's default execution policy, Restricted, refuses script files, so S15 checks passing the script inline instead, which execution policy does not cover (**to confirm**). **cmd** gets nothing, as its prompt can't report an exit status, and command navigation says why. **WSL** gets the bash, zsh and fish injection through `wsl.exe` with the script folder passed by `WSLENV` path translation, if S15 confirms it; otherwise it gets nothing and says why.                    |
| P-103 | **To confirm.** Uninstalling the app leaves `~\.trc` and a running local daemon, as removing the app on macOS leaves its LaunchAgent; Remove daemon (US-3.3) deletes them. Logout, reboot and the NFR-11 cycles that would end the owner's own Windows session run in a Windows 11 test VM in Hyper-V, set up in S15; turning Hyper-V on takes the owner's administrator approval once. Without the VM, they are manual checks on this PC.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P-104 | Contrast themes with Match System (A11Y-07.3, ST-79): the terminal takes its palette from the CSS system colors the theme sets, background, text, selection, links and dim text, and nothing else; ANSI black is the background, bright black the dim text, blue and cyan the link color, every other ANSI color the text color, and the minimum contrast ratio still applies. The text surface opts out of forced colors (`forced-color-adjust: none`), or Chromium paints its transparent text over the canvas.                                                                                                                                                                                                                                                                                                                                             |
| P-105 | **To confirm (changes P-35).** On Windows, the connection-host and scale echo checks (NFR-02, NFR-05) compare their p99 with the round trip's own p99, sampled over the same connection just before, instead of its median; macOS keeps P-35's median. Windows OpenSSH's round trip has a long tail of its own: plain `ssh.exe` to a test host echoed at 1.5 ms p50 and 15 to 22 ms p99, so the median counts that tail as the app's (E6-nfr.md).                                                                                                                                                                                                                                                                                                                                                                                                             |
| P-106 | **To confirm.** On Windows, a link whose target is a `file:` URL naming a host other than localhost is refused, as Windows opens it as a UNC path over SMB and offers that host the user's credentials (SEC-06.2); local `file:` links and every other scheme keep the confirmation. macOS keeps opening `file:` links with a host, which `ls --hyperlink` names the computer itself with.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## 3. Design

### 3.1 Windows OpenSSH (US-6.1.2, US-1.1 to US-1.5, P-89 to P-91)

- `runtime.ts` takes ssh, ssh-keygen and ssh-add from `%SystemRoot%\System32\OpenSSH` on Windows, with
  `windowsHide`, and keeps `/usr/bin` elsewhere. The helpers are `[trcd.exe, 'askpass']` and
  `[trcd.exe, 'known-hosts']`, quoted for ssh's own argument splitting as S9 finds it.
- US-1.3's refused-key checks read Windows' agent errors (no agent, service disabled, empty agent). The host picker
  walks `%USERPROFILE%\.ssh\config` and its `Include`s, with Windows paths and `~` forms.
- The bootstrap is unchanged: it runs on the host. Uploads stay binary-safe through ssh's stdin.
- The unit tests that fake ssh with an sh script (D-64) get a Windows double. The live paths run against the test
  hosts (P-96).

### 3.2 Windows conventions (US-6.1.3, A11Y-04.6, A11Y-05, A11Y-11, P-86, P-92, P-93)

- `menu.ts` builds the macOS menus or P-92's Windows menus from the same commands. On Windows the menus show the
  Control+Shift chords and register no accelerator a terminal key needs (keymap rule 7).
- `keymap.ts` gains per-OS defaults. The rule checker gains Windows' reserved keys, and rebinding refuses them with
  the reason (rule 5).
- The key encoder sends AltGr characters as text, and Alt+letter as Meta in the terminal. Copy paths (selection,
  review mode, last command output) use one `platformLineBreak`.
- Settings' Keyboard section gains "Ctrl+C copies when text is selected" (P-86), off by default.

### 3.3 The Accessible Text Surface on Windows (US-6.1.1, A11Y-01 to A11Y-04, A11Y-06, A11Y-07, A11Y-09, R1, R2)

- **S9 maps the ATS through UI Automation**, as S2 did through NSAccessibility: the terminal's control type and
  name; TextPattern selection in the live terminal and review mode, up to A11Y-04.7's cap; the caret range and its
  bounding rectangle, which Magnifier follows; `RangeFromPoint` under the pointer, which read aloud's Ctrl+Alt+click
  uses; and text-changed events for Narrator.
- What S9 finds missing is fixed in ST-79, with `uia-probe` assertions so it stays fixed.
- **Display preferences** (A11Y-07, A11Y-08): contrast themes through forced colors (TECH_STACK §4.4), dark mode,
  animation effects mapped to reduced motion, and Windows' text size; S9 checks what Chromium passes through.
- **Input** (A11Y-09): IME candidates appear at the terminal cursor, and Voice Typing and Voice Access dictation
  insert into the focused terminal.

### 3.4 Packages, CI and the release (SEC-04, P-87)

- `electron-builder.yml`'s `win` section builds `nsis` (per user, `allowElevation: false`) and `zip` for x64 and
  arm64. The daemon resources are the Linux and macOS daemons from `macos-15`'s job (D-54, D-61) plus that
  architecture's `trcd.exe`; 0.8.0 adds `conpty.dll` and `OpenConsole.exe` beside it.
- `pnpm verify:artifact` runs on each Windows runner. It checks the fuses, the asar integrity, the daemon manifest's
  SHA-256 values, that no listener opens (including after `--remote-debugging-port`), and that the installer
  installs and uninstalls without elevation.
- `release.yml` gains Windows package and smoke jobs. `publish` attaches `TRC-<version>-win-<arch>-setup.exe` and
  `TRC-<version>-win-<arch>.zip`. `ci.yml`'s Windows job stops skipping the release commit and runs on
  `windows-11-arm` too. Both runners install Zig 0.17 and minisign, verified as on macOS, for libghostty-vt.

### 3.5 `trcd` on Windows (0.8.0, US-6.2, P-99 to P-101)

- **Platform modules** behind `cfg(unix)` and `cfg(windows)`:
    - `socket` and `peer` become pipes and token SIDs;
    - `private_dir` and the integrity check (SEC-04.4) become owner and DACL checks, refusing a root or binary any
      other non-administrator account can write;
    - `holder::pty` becomes ConPTY;
    - process start, stop and liveness use handles and job objects instead of signals and PIDs;
    - `launchd` gets a Windows sibling for P-100's auto-start;
    - `run_dir` uses the pipe namespace.
- **Everything above the platform layer is shared and keeps its tests:** the protocol, the registry, persistence,
  restore, history and shell integration.
- **ConPTY output** goes through the same libghostty-vt emulator. R8's repaints (`cls`, progress bars, PSReadLine
  redraws) are measured against the announcer's logical-line diffing in S15, and fixed in the holder or the
  announcer.

## 4. Stories

### Part 1: 0.7.0, the Windows app reaches every remote host

**ST-74 Plan and decisions**

- **This plan.** The doc-ID check reads it.
- **PRD v0.20:** §7.1 names x64 and arm64 for Windows; §7.3's Windows read aloud adds Magnifier's read aloud;
  A11Y-04.2 and A11Y-06 name it; A11Y-04.6 gets P-86's strict default.
- **TECH_STACK v1.11:**
    - §4.5's installer and architectures, replacing D-63;
    - `uia-probe` and the `windows` crate (§9.1.1, §13);
    - the TypeScript test-host tools;
    - the Windows CI rows of §9.8;
    - S9 re-scoped and S15 in §11;
    - the decisions as D-65 onward.
- **Done when** the doc-ID check passes and `docs(plan): ...` is committed.

**ST-75 Spike S9: Windows OpenSSH, the ATS through UI Automation, Windows display settings** (R1, R2, US-6.1)

- **Windows ssh:**
    - how it starts `KnownHostsCommand` and `SSH_ASKPASS` with `SSH_ASKPASS_REQUIRE=force` and no console;
    - quoting with spaces and non-ASCII names in the helper's path;
    - console windows;
    - `ssh -G` for `NUL` and `/dev/null`;
    - the agent's errors with the service disabled, stopped and empty;
    - ProxyCommand and ProxyJump.
- **The ATS through UI Automation** (§3.3), with Accessibility Insights and a first `uia-probe`, plus Narrator on
  the live terminal.
- **Display settings and input:** contrast themes, text size and animation effects; the native menu bar with
  Alt+letter in the terminal; AltGr on a German and a Brazilian layout; the IME's position.
- **Test hosts:** the compose file on Docker Desktop, the systemd containers included.
- **Output:** findings in `docs/spikes/S9.md`; §3 revised if they ask for it.

**ST-76 Test tooling on Windows** (P-96, P-97, P-98)

- `tools/test-hosts/*.ts` replace `up.sh`, `down.sh`, `rust-tests.sh` and `fetch-old-daemon.sh` on both OSes.
- D-27's unseen launches on Windows.
- `tools/uia-probe` and `pnpm test:ax:win`.
- The integration, e2e, NFR and soak projects pass on Windows, or skip by name where a scenario is POSIX-only.

**ST-77 Windows OpenSSH** (US-6.1.2, US-1.1 to US-1.5, US-1.14, P-89 to P-91)

- §3.1: the absolute paths, the version check, `trcd.exe`'s helper subcommands and its Windows build, `NUL`, the
  agent's messages and hidden console windows.
- The connection suites against the test hosts from Windows, ProxyJump included.

**ST-78 Windows conventions** (US-6.1.3, US-1.12, A11Y-04.6, A11Y-05, A11Y-11, P-86, P-92, P-93)

- §3.2: the menus, the Windows keymap and its table in keymap.md, strict copy and paste with the opt-in setting,
  CRLF copies, AltGr, and Alt+letter in the terminal.
- Windows' own context-menu keys (Shift+F10, the Menu key).

**ST-79 The ATS on Windows** (US-6.1.1, A11Y-01 to A11Y-04, A11Y-06 to A11Y-09, R1, R2)

- S9's fixes, test-first with `uia-probe`.
- Magnifier's caret tracking and read aloud from the pointer and of the selection.
- Contrast themes, text size and animation effects.
- The IME and dictation.

**ST-80 Windows platform fixes** (SEC-02, SEC-05, SEC-08, US-5.3, P-85, P-94, P-95)

- P-94's DACL and indexing flag, P-95's rename retry and `~\`.
- OS notifications through the AppUserModelID.
- `openExternal` and the links' confirmation on Windows.
- Where This computer would be, the sidebar says local sessions arrive in a later release.

**ST-81 Windows packages and release** (SEC-04, P-87)

- §3.4: the NSIS installer and zip for x64 and arm64.
- `trcd.exe` per architecture.
- `verify:artifact` on both Windows runners.
- The CI and release jobs.
- A release dry run (`pnpm release minor --dry-run`).

**ST-82 Docs for 0.7.0**

- USER_GUIDE:
    - installing on Windows, and SmartScreen's warning for an unsigned build;
    - Windows OpenSSH and its agent;
    - the Windows keymap, copy and paste;
    - Magnifier's read aloud.
- keymap.md, README and CLAUDE.md.
- `E6-windows-bringup.md`'s items marked done or moved to Part 2.

**ST-83 0.7.0 verification** (NFR-02, NFR-03, NFR-04, NFR-06, NFR-07, NFR-11)

- From Windows against `trc-ubuntu`:
    - NFR-02's latency;
    - NFR-03's interrupt under a flood;
    - NFR-04 with Narrator on;
    - NFR-06's startup;
    - NFR-07's detection and reconnect;
    - the app quit and crash soaks.
- `E6-manual-at.md` and `E6-security.md` written for both releases.
- Results in `docs/verification/E6-nfr.md`.

**ST-84 Release gate, reviews and v0.7.0** (PRD §9 for US-6.1)

- The full suites on macOS and Windows, then `code-reviewer` and `technical-auditor` over every commit after v0.6.1,
  in rounds until no critical or high finding remains (P-64).
- The owner's confirmation (§6), then `pnpm release minor` to 0.7.0.

### Part 2: 0.8.0, local Windows sessions and command-aware PowerShell

**ST-85 Spike S15: ConPTY holders, job objects, auto-start and PowerShell** (R4, R5, R8 on Windows)

- **Holders and job objects:**
    - a ConPTY holder outliving its core and the app, started from a job that allows breakaway and from one that
      forbids it;
    - the Run value against a Task Scheduler logon task;
    - pipe peer checks against another account.
- **Output and shells:**
    - R8's repaints with the announcer;
    - `trc.ps1` in pwsh 7 and Windows PowerShell 5.1 under each execution policy;
    - WSL with `WSLENV`.
- **The test VM:** Hyper-V, for logout and reboot (P-103).
- **Output:** findings in `docs/spikes/S15.md`; §3.5 and P-99 to P-102 revised if they ask for it.

**ST-86 `trcd` on Windows** (US-6.2.5, SEC-01, SEC-02, SEC-04.4, NFR-08, NFR-09, NFR-10)

- §3.5's platform modules and P-99.
- `trcd` tests on `windows-2025` and `windows-11-arm`.
- D-62's clippy-for-musl stand-in dropped.

**ST-87 Windows service mode** (US-6.2.1, US-6.2.3, US-2.5, R4, R5, P-100)

- Auto-start, breakaway and the fallback.
- Upgrade without session loss.
- Restore at login.
- Remove daemon on Windows (US-3.3).

**ST-88 This computer on Windows** (US-6.2.2, US-6.2.4, US-4.2, P-101)

- Install, the bridge, the profiles and their detection, the environment, Stop and its grace period.
- File-path links for Windows paths (US-1.12.3).

**ST-89 ConPTY output and announcements** (R8, A11Y-02, A11Y-12)

- S15's findings fixed, with captured ConPTY streams in the golden corpus.

**ST-90 Command-aware PowerShell and WSL** (US-6.3, US-6.2.6, US-5.1 to US-5.3, P-102)

- `trc.ps1`, locally and on remote hosts with pwsh.
- WSL's injection.
- PowerShell with PSReadLine among the verified programs.
- pwsh added to the Ubuntu test image.

**ST-91 Docs for 0.8.0**

- USER_GUIDE: local Windows sessions, profiles, auto-start and its switch, PowerShell integration and its execution
  policy.
- README and CLAUDE.md.

**ST-92 0.8.0 verification** (NFR-01, NFR-05, NFR-06, NFR-08, NFR-09, NFR-10, NFR-11)

- On This computer on Windows:
    - NFR-01's local latency;
    - NFR-05's scale;
    - NFR-06's local listing;
    - NFR-08's durability;
    - NFR-09's footprint per ConPTY holder (with OpenConsole's share).
- The NFR-11 soaks of daemon kill and upgrade, and app quit and crash, on Windows; logout and reboot in the VM.
- Results in `E6-nfr.md`.

**ST-93 Release gate, reviews and v0.8.0** (PRD §9 done for E6, apart from P-88's manual passes)

- The full suites on both OSes, then the reviews over every commit after v0.7.0, as in ST-84.
- The VM deleted.
- The owner's confirmation (§6), then `pnpm release minor` to 0.8.0.

## 5. Traceability

| PRD item                  | Stories               | PRD item               | Stories                    |
| ------------------------- | --------------------- | ---------------------- | -------------------------- |
| US-6.1                    | ST-75, ST-77 to ST-80 | A11Y-01 to A11Y-04     | ST-75, ST-78, ST-79        |
| US-6.2                    | ST-85 to ST-89        | A11Y-05, A11Y-11       | ST-78                      |
| US-6.3                    | ST-85, ST-90          | A11Y-06 to A11Y-09     | ST-75, ST-79               |
| US-1.1 to US-1.5, US-1.14 | ST-77                 | A11Y-02, A11Y-12 (R8)  | ST-85, ST-89               |
| US-1.12, US-5.3           | ST-78, ST-80          | SEC-01, SEC-02         | ST-80, ST-86               |
| US-2.5, US-3.3, US-4.2    | ST-87, ST-88          | SEC-04, SEC-05, SEC-07 | ST-80, ST-81, ST-86, ST-87 |
| R1, R2 (Windows)          | ST-75, ST-79          | NFR-01 to NFR-11       | ST-83, ST-92               |
| R4, R5, R8 (Windows)      | ST-85, ST-87, ST-89   | SEC-06, SEC-08         | ST-80, ST-84, ST-93        |

## 6. How it runs

This session implements every story; sub-agents are used only for research, exploration and the reviewers at the
end of each part. Every decision is made here and recorded as a P-xx, marked **to confirm** when it changes the PRD or
an earlier decision.

There are two stops, after ST-84's and ST-93's gates and reviews, right before each release. At each, every decision
since the last stop is listed for the owner, those that change the PRD or a previous decision first.

The owner is warned before anything that takes focus (`pnpm test:ax:win`, `test:ax:mac`), speaks (Narrator for
NFR-04), needs Docker Desktop running, or would touch their Windows session (logout, reboot), which runs in the VM
instead (P-103).

## 7. Status

| Story | Status | Commit                    |
| ----- | ------ | ------------------------- |
| ST-74 | Done   | 5d4dfd1                   |
| ST-75 | Doing  |                           |
| ST-76 | Doing  | e1f262a, e763804, 0625166 |
| ST-77 | Done   | 47ba320                   |
| ST-78 | Done   | 14765f5                   |
| ST-79 | Doing  | 8bf0e69                   |
| ST-80 | Done   | 19d565e, 14765f5          |
| ST-81 | Doing  | f18a947                   |
| ST-82 | Doing  |                           |
| ST-83 | Doing  | a8e0098                   |
| ST-84 | To do  |                           |
| ST-85 | To do  |                           |
| ST-86 | To do  |                           |
| ST-87 | To do  |                           |
| ST-88 | To do  |                           |
| ST-89 | To do  |                           |
| ST-90 | To do  |                           |
| ST-91 | To do  |                           |
| ST-92 | To do  |                           |
| ST-93 | To do  |                           |

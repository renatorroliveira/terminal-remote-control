# Epic 5 implementation plan: command-aware terminal

| Field  | Value                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------- |
| Status | Approved by the owner on 2026-11-18                                                            |
| Owner  | Renato Oliveira                                                                                |
| Scope  | PRD §9.5 (US-5.1 to US-5.4) plus every global requirement for what E5 delivers, and P-72       |
| Inputs | [PRD.md](../PRD.md) v0.19, [TECH_STACK.md](../TECH_STACK.md) v1.10, the E1 to E4 plans, v0.5.0 |

## 1. Context

E4 shipped as v0.5.0: local sessions on the Mac, and macOS hosts. The owner now works inside a TRC local session
every day. E5 makes the terminal command-aware:

- shell integration injected without editing dotfiles (US-5.1);
- moving between commands, and hearing each one's output and exit status (US-5.2);
- events from sessions in the background (US-5.3);
- a quick switcher over every session on every host (US-5.4).

0.6.0 also carries six usability changes the owner asked for after using 0.5.0 (P-72, ST-64).

What exists:

- `ShellProfile.integration` (auto or off) and `AttachMode::Events`, reserved since E1;
- the announcer's groups, merging and politeness;
- audio cues, the in-app notification list, the tree's bell and new-output badges, and the command palette.

What is missing:

- **OSC 133.** libghostty-vt parses it and has a semantic-prompt callback, which nothing registers.
- **The bell.** The holder drops it.
- **OS notifications.** None exist, and the main process denies every web permission.
- **Events from sessions the app never opened.**
- **Marks across a snapshot.** The VT formatter writes no OSC 133, so a snapshot or a restore loses every mark;
  a delta replay keeps them.

E1's working agreement (E1 plan §3) and its autonomy rule (P-20) apply unchanged. The owner's real sessions,
including the one this work runs in, live in `~/.trc`, so tests kill processes only by patterns under their scratch
roots.

## 2. Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-68 | Story and decision numbers continue from the E4 plan (ST-62 onward, P-68 onward); the spike is S14.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P-69 | **Owner, 2026-11-18, closes OQ-6.** TRC reads OSC 133 and OSC 7, and three keys of iTerm2's OSC 1337: `CurrentDir`, taken as OSC 7 is, while the last `RemoteHost`, if any, names this host; `RemoteHost`, which qualifies it; and `SetMark`, a mark without an exit status. Every other 1337 key, `File=` among them, is ignored (SEC-06). OSC 633 is not read.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| P-70 | **Owner, 2026-11-18.** A bell, a process exit or a long command finishing in a background session is announced politely by default; OS notifications are opt-in per event type.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| P-71 | **Owner, 2026-11-18.** macOS shells are tested on This computer, with a scratch local daemon, and on the tart VM again (`trc-mac-gui`, `trc-mac-nogui`); as P-57 had it, the VM is deleted after each run and its base image at the end of E5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| P-72 | **Owner, 2026-11-18.** 0.6.0 is E5 under 0.5.0's gates, plus ST-64: a Settings view in the content region reached from a sidebar link (and from the menu, Cmd+, and the palette, the same way); 10 px more space below each host's sessions; no user field in Add host, as `user@host` goes in the host field (US-1.1.6 amended); F2 renames the session whose row has focus; the theme choice in Settings' Appearance section; and the reason macOS asks about `trcd` and folders nothing opened.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P-73 | Injection (D-55): TRC's own scripts, embedded in `trcd`, written by the core to `<root>/shell-integration/<version>/` and applied by the holder at every shell start. bash 4 and later get `--posix` with `ENV`, as kitty and Ghostty do, so a login shell stays one and the system bashrc is read once; macOS's bash 3.2, which ignores `ENV` when interactive, gets a non-login `--rcfile` that sources the login files, as VS Code does; zsh gets a `ZDOTDIR` `.zshenv`; fish gets `XDG_DATA_DIRS`, and its script adds nothing fish 4 marks itself. Other shells get nothing. A guard variable keeps a script from loading twice, and the holder ignores a repeated prompt mark or an end without a start.                                                                                                                                                                                                                |
| P-74 | Marks travel as OSC 133 in the VT stream (D-56): the holder tracks each command from libghostty-vt's semantic-prompt callback, with its prompt row, exit status and times, and writes the marks back into snapshots and saved history; the app's xterm.js handler then builds them the same way from a snapshot, a replay or live output. Should S14 find tracked rows unreliable, an attach would carry the command list out of band instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| P-75 | Protocol 4 and holder protocol 4 (D-57): the holder sends `Bell`, at most once a second, and `CommandFinished { exitCode, durationMs }`; the core broadcasts them as `SessionEvent` `event` changes to protocol 4 clients; `SessionInfo.integration` is `injected`, `native`, `off` or `unsupported`, so a refused command navigation can say why (US-5.2.3); `SessionOptions.integration` defaults to on per field, so older `meta.json` files still read. Protocol 3 peers keep working (NFR-12). No command line is kept, sent or logged, fish's `cmdline_url` included.                                                                                                                                                                                                                                                                                                                                                   |
| P-76 | OS notifications are posted by the main process with Electron's `Notification`; they hold the session name, host and event, never output, and clicking one opens the session. Electron 45 needs a signed app for them; S14 checks that the ad-hoc-signed build qualifies.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| P-77 | Shortcuts that work the same in the terminal and in review mode, where Cmd+Up and Cmd+Down already move to the start and end: Option+Cmd+Up and Option+Cmd+Down go to the previous and next command; Option+Cmd+R reads the last command's output, Option+Cmd+A selects it and Option+Cmd+C copies it; Cmd+P opens the quick switcher. F2 renames only while a session row has focus, as a global F2 would take the key from terminal programs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| P-78 | Defaults: a failed command in the open session is announced ("Command failed, exit code 2"); the success and failure cues are switchable apart and play only with audio cues on, which they are not by default; a command is long after 10 s, a setting; a bell, an ended session or a finished long command stays a badge in the row's description until the session is viewed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| P-79 | After S14: a session keeps the marks of its last 1,000 commands (3,000 marks), which costs a snapshot of 100,000 lines about 3 ms more; older commands keep their output but lose their marks. The privacy prompts that name `trcd` come from programs run in a session (Claude Code, in the owner's case), for which launchd's `trcd` is the responsible process, so P-66 stands with no code change, and the user guide says why `trcd` is named (ST-64, item 6).                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P-80 | ST-67's choices. The renderer keeps its own marks with the daemon's repairs (P-74), from OSC 133 and `SetMark`, at most 1,000 commands, none on the alternate screen; a replay rebuilds them without announcing. Previous and next command move among commands that ran (and `SetMark` rows), from the prompt in the terminal, scrolling each to the top, and from the caret in review mode; they stop at either end and say so. Read last command output speaks at most its last 100 lines (select or copy it for the rest). Copy puts the text on the clipboard through a new `clipboard:copy` call to the main process (16 MiB at most), as the sandboxed page can't. The failure cue is on and the success cue off by default, both only while sound cues are on. A refused move names the cause: integration off for the host, a shell without it, a shell started without it, no command yet, or a full-screen program. |

## 3. Design

### 3.1 Injection (US-5.1, P-73)

- `crates/trcd/shell-integration/` holds `bash/trc.bash`, `zsh/.zshenv` and `zsh/trc-integration.zsh`, and
  `fish/vendor_conf.d/trc.fish`, embedded with `include_str!` and written by `core::process::run` beside `logs/`
  and `run/`, in a folder per daemon version.
- `HolderSpec` carries that folder. `spawn_spec` asks the profile's `ShellKind`, and for bash its major version,
  which profile detection records, for the arguments and variables; the session's `integration` option, its
  profile's and its host's switch can each turn it off.
- Restart and restore run `spawn_spec` again, so a respawned shell is injected as the first one was.

### 3.2 Semantic events and marks (US-5.1.2, US-5.2, US-5.3, P-74, P-75)

- `trc-vt` registers the semantic-prompt callback and returns `TerminalEvent::Prompt`, `CommandStart`,
  `OutputStart` and `CommandEnd { exit }`; a small streaming scanner reads OSC 1337's three keys.
- The holder keeps the command table, a ring bounded like the scrollback, with a tracked row per prompt, stops
  dropping `Bell`, and reports `integration`. Snapshot and history formatting write `OSC 133 ; A`, `B`, `C` and
  `D ; <code>` before the rows they mark.
- The core relays `Bell` and `CommandFinished` and filters broadcasts by each client's protocol.

### 3.3 The app (US-5.2 to US-5.4)

- `terminal/command-marks.ts` builds the command list from xterm.js OSC 133 and 1337 handlers, as VS Code's
  command detection keeps prompt, command, output and end markers. Replays build marks but never speak or play.
- Previous and next move the viewport (`scrollToLine`) or, in review mode, the caret (`ReviewField.select`); read,
  select and copy take the last finished command's output, within A11Y-04's selection cap.
- A failed command in the open session is announced after its output's speech, with its cue. Background events are
  announced in a group per session, which merges them (A11Y-12.3), posted as OS notifications when switched on, and
  shown as badges until the session is viewed.
- The quick switcher is React Aria `Autocomplete` with `ListBox`: every session on every host, matched on name,
  host and title, with the result count announced; choosing one opens it as US-1.8 does.

### 3.4 Settings view and the other usability changes (P-72)

- The Settings view replaces the Settings dialog in the content region: at most 1280 px wide and centered, as the
  terminal is, with a 400 px list of sections and the search above it, and the section on the right. At 320 CSS px
  the list stacks above the section (A11Y-07.5). Its sections are Appearance, Speech, Sound, Keyboard, Sessions,
  Commands, Background events and Hosts.
- The sidebar ends with a Settings link above the status bar, marked current while Settings shows. The link, the
  app menu's Settings…, Cmd+, and the palette all run `settings.show`. Choosing a session or pressing Escape goes
  back to the terminal, and the region cycle reaches the view as it does the terminal.

## 4. Stories

**ST-62 Plan and decisions**

- This plan; PRD v0.19: OQ-6 closed, US-1.1.6, US-1.6.7, US-1.10.10, US-5.1.2 and US-5.3.1 amended; TECH_STACK
  v1.10: §6's protocol 4, §8's injection, D-55 to D-57, the E5 row of §10 and S14 in §11; the doc-ID check reads
  this plan.
- Done when the doc-ID check passes and `docs(plan): ...` is committed.

**ST-63 Spike S14: injection, marks, notifications and privacy prompts**

- Every P-73 injection, as a login and a non-login shell, on Ubuntu (bash 5.2, zsh, fish 3.7), Alpine (bash, zsh,
  fish 4), Rocky (bash 5.1, zsh) and This computer (bash 3.2, zsh 5.9), with dotfiles that already set
  `PROMPT_COMMAND`, `precmd` or starship, or load iTerm2's integration; marks for multi-line commands, Ctrl+C, an
  empty Return, `exec` and nested shells.
- Marks written back through a snapshot and a save and restore (P-74); an OS notification from the ad-hoc-signed
  package (P-76); what makes macOS ask whether `trcd` may open Desktop and Downloads, from the TCC log.
- Findings in `docs/spikes/S14.md`; §3 revised if they ask for it.

**ST-64 Usability for 0.6.0** (P-72, US-1.1.6, US-1.6.7, US-1.10.10, A11Y-07, A11Y-10.3, A11Y-11)

- §3.4's Settings view and link; the space below each host's sessions; Add host without its user field; F2;
  the theme choice in Appearance; the privacy prompts' cause, fixed test-first.

**ST-65 Shell integration injection** (US-5.1.1, US-5.1.3)

- §3.1; `SessionOptions.integration` and a per-host switch in `hosts.json`, sent on Create and with
  `SetSessionOptions`; bash, zsh and fish in the test images, and integration tests of every shell in the three
  containers.

**ST-66 Semantic events and marks** (US-5.1.2, US-5.3, NFR-05, NFR-12)

- §3.2: the command table, the bell, OSC 7 and 1337, marks in snapshots and history; protocol 4 and holder
  protocol 4; the core's events; tests against protocol 3 peers.

**ST-67 Command navigation and announcements** (US-5.2, A11Y-03, A11Y-04, A11Y-12)

- §3.3's marks, previous and next, read, select and copy, in the terminal and in review mode; the failed-command
  announcement and both cues; the reason a refused navigation gives; keymap, menus, help, palette and settings.

**ST-68 Background events** (US-5.3)

- Announcements, OS notifications, badges and the long-command threshold; the background bell comes from the
  daemon's event, so it covers sessions never opened.

**ST-69 Quick switcher** (US-5.4, US-1.8)

- §3.3's switcher, its shortcut, menu item and palette entry.

**ST-70 macOS hosts** (P-71)

- The VM again (`tools/test-hosts/macos/up.sh`); E5's integration and e2e paths on `trc-mac-gui`, `trc-mac-nogui`
  and This computer.

**ST-71 Docs**

- USER_GUIDE: shell integration and turning it off, commands, background events, the quick switcher and the
  Settings view; `docs/design/keymap.md`; README and CLAUDE.md.

**ST-72 E5 verification** (NFR-04, NFR-05, NFR-09, NFR-11)

- NFR-04 for the failed-command announcement; NFR-05 with events on 25 hosts × 100 sessions; NFR-09 with command
  tracking; the NFR-11 soaks with integration on. Results in `docs/verification/E5-nfr.md`.

**ST-73 Release gate, reviews and v0.6.0** (PRD §9 done)

- The full suites; `E5-manual-at.md` and `E5-security.md`; `code-reviewer` and `technical-auditor` over every commit
  after v0.5.0, in rounds until no critical or high finding remains, as P-64 had it; the VM and its image deleted
  (P-71); the owner's confirmation (§6), then `v0.6.0`.

## 5. Traceability

| PRD item                | Stories             | PRD item         | Stories             |
| ----------------------- | ------------------- | ---------------- | ------------------- |
| US-5.1                  | ST-63, ST-65, ST-66 | NFR-04, NFR-05   | ST-66, ST-72        |
| US-5.2                  | ST-63, ST-66, ST-67 | NFR-09, NFR-11   | ST-72               |
| US-5.3                  | ST-63, ST-66, ST-68 | NFR-12           | ST-66               |
| US-5.4                  | ST-69               | SEC-06, SEC-08   | ST-66, ST-73        |
| US-1.1, US-1.6, US-1.10 | ST-64               | A11Y-10, A11Y-12 | ST-64, ST-67, ST-68 |

## 6. How it runs

**Owner, 2026-11-18.** This session implements every story; sub-agents are used only for research, exploration and
the reviewers at the end of E5. Every decision is made here and recorded as a P-xx, marked **to confirm** when it
changes the PRD or an earlier decision. The one stop is after ST-73's gate and reviews, right before the release:
every E5 decision is listed for the owner, those that change the PRD or a previous decision first, with the manual
AT passes and any theme still missing. `pnpm test:ax` takes focus, so the owner is warned before it runs.

## 7. Status

| Story | Status  | Commit  |
| ----- | ------- | ------- |
| ST-62 | Done    | 20381a2 |
| ST-63 | Done    | afda418 |
| ST-64 | Done    | a68d223 |
| ST-65 | Done    | 626a045 |
| ST-66 | Done    |         |
| ST-67 | Planned |         |
| ST-68 | Planned |         |
| ST-69 | Planned |         |
| ST-70 | Planned |         |
| ST-71 | Planned |         |
| ST-72 | Planned |         |
| ST-73 | Planned |         |

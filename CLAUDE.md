# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Pre-implementation. The repository holds product documentation only; there is
no source code, build system, linter or test runner yet. When tooling lands,
add its commands (build, lint, full test run, single test) to this file.

`docs/PRD.md` is the source of truth for requirements. Reference its IDs in
designs, code reviews and commits:

- Global requirements every epic must meet: `A11Y-*`, `SEC-*`, `NFR-*`.
- Epics `E1`–`E7`: incremental, usable deliverables. Each epic's acceptance
  criteria is its list of user stories, `US-<epic>.<n>`.

The implementation breakdown of each epic will go in `docs/DELIVERY_PLAN.md`
(not created yet), not in the PRD.

Platforms arrive in this order (PRD §7.4): macOS desktop app plus Linux remote
daemon (E1–E4), macOS daemon for local sessions and macOS hosts (E5), Windows
desktop (E6), Linux desktop (E7). Don't build ahead for later platforms, and
don't make choices that block them (for example, never depend on
`ControlMaster`, which Windows OpenSSH lacks).

## What the product is

A desktop terminal manager. An Electron app (built the way VS Code is) shows a
session list on the left and the selected terminal in the center. Sessions
belong to a per-user **daemon** on each host, not to the app, so they survive
app quit, app crash, network loss and client reboot. After a host reboot, the
daemon respawns each session's shell and restores its scrollback; it never
re-runs commands.

## Planned architecture

These components span the whole system; changes in one usually constrain the
others.

- **Desktop app (Electron).** Renders sessions and relays input. Holds no
  session state that is not recoverable from a daemon.
- **Daemon.** One per user per host, the same binary locally and remotely.
  Registered with the OS per-user service manager (launchd LaunchAgent, systemd
  user unit, Windows per-user auto-start). Owns PTYs (ConPTY on Windows),
  supervises processes, persists scrollback, and serves multiple attached
  clients at once. A daemon crash or upgrade must not end sessions (US-2.5), so
  PTY holders must be separate from the upgradable daemon core *and* outside
  the service manager's kill scope: systemd kills the whole unit cgroup,
  launchd kills the job's process group, and ConPTY children die with their
  owner.
- **Remote hosts (Linux x86_64/arm64, macOS).** The app connects with the
  system OpenSSH client and the user's SSH config and agent, uploads the daemon
  binary bundled in the app, verifies its SHA-256, installs it under the user's
  home without sudo or internet access, and talks to it through the SSH
  connection (an exec channel bridged to the daemon's Unix socket, so it works
  even when SSH forwarding is disabled). On Linux without systemd lingering, a
  user unit dies about 10 s after the last SSH session closes, so the daemon
  must then run detached outside the user's systemd instance (US-2.4). Remote
  macOS without a GUI login gets a detached daemon too.

## Non-negotiable constraints

- **Accessibility is the number one requirement and a release gate.** WCAG 2.2
  AA plus native integration with VoiceOver, JAWS, NVDA, Narrator, Orca,
  magnifiers and voice control on macOS, Windows and Linux. Any change to
  terminal rendering, focus, keyboard handling, selection or UI chrome must
  keep the global `A11Y-*` requirements in `docs/PRD.md` passing. In
  particular:
  - Terminal text must be exposed to the OS as real text, not only pixels.
  - Terminal selection must be real OS-visible selection (A11Y-04), which a
    canvas/WebGL renderer does not provide on its own.
  - The OS must be able to track focus and the terminal cursor (A11Y-06).
  - Focus must never be trapped in the terminal (A11Y-05).
- **No network listeners anywhere, including loopback.** Daemon IPC uses a Unix
  socket (mode 0600 inside a 0700 directory) or a Windows named pipe restricted
  to the user. Peers are authenticated by OS identity (peer credentials, pipe
  client account), never by tokens or secrets the product mints itself.
  Remote access goes only through SSH.
- **SSH is key-based only.** Never prompt for passwords, passphrases or
  keyboard-interactive input. Never relax host-key checking or enable agent
  forwarding on the user's behalf.
- **No root, sudo or administrator rights** for install, upgrade, operation or
  removal on any host.
- **Terminal output is untrusted.** OSC 52 clipboard writes are off by default,
  clipboard reads are refused, and no escape sequence acts without a user
  action.
- **Logs never contain terminal output, keystrokes, environment values or key
  material.**

## Commits

- Always write commit messages in the
  [Conventional Commits](https://www.conventionalcommits.org/) format:
  `type(scope): subject`, for example `docs(prd): ...` or `feat(daemon): ...`.
- After the subject line, add a body of 1 to 3 paragraphs that summarizes what
  changed and why, word-wrapped at 72 columns.
- Reference the PRD IDs the change implements or affects (`US-1.4`,
  `A11Y-04`, ...).

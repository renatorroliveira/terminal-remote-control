# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

E1 is in progress; see `docs/plans/epic-01-implementation-plan.md` for the
story status. The monorepo holds the Electron app (`apps/desktop`), the
protocol package (`packages/protocol`), the Rust crates (`crates/*`) and
tooling (`tools/*`).

## Commands

- Full local gate: `pnpm check` (Prettier, Biome, document IDs, `tsc` per
  process, Vitest node and browser projects, `cargo fmt`, clippy, nextest).
- Lint only: `pnpm lint`. Format: `pnpm format`. Types: `pnpm typecheck`.
- Unit and component tests: `pnpm test`; one test:
  `pnpm exec vitest run <file> -t <name>`.
- Rust: `cargo nextest run --workspace`; one test: `cargo nextest run <name>`.
- Integration (needs `tools/test-hosts/up.sh`): `pnpm test:integration`.
- End to end: `pnpm test:e2e`. Accessibility tree: `pnpm test:ax` (needs the
  macOS Accessibility permission).
- The git hooks install with `pnpm install` into `.git/hooks`; a global
  `core.hooksPath` hook manager runs them. Never bypass hooks with
  `--no-verify`.

`docs/PRD.md` is the source of truth for requirements. Reference its IDs in
designs, code reviews and commits:

- Global requirements every epic must meet: `A11Y-*`, `SEC-*`, `NFR-*`.
- Epics `E1`–`E7`: incremental, usable deliverables. Each epic's acceptance
  criteria is its list of user stories, `US-<epic>.<n>`.

`docs/TECH_STACK.md` records the chosen languages, libraries, tools, configs and
the decision log (`D-01`…). Keep the stack minimal: the PRD is the scope, so
add nothing it doesn't need. Record any new or changed dependency or tool in
`docs/TECH_STACK.md` first.

The implementation breakdown of each epic goes in
`docs/plans/epic-NN-implementation-plan.md`, not in the PRD. Its stories are
`ST-<n>` and its planning decisions `P-<nn>`. E1's plan is
`docs/plans/epic-01-implementation-plan.md`; keep its status table current.

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

- **Desktop app (Electron, TypeScript 7, React).** Renders sessions and relays
  input. It holds no session state that a daemon can't recover. Three
  processes:
    - The main process holds no session state.
    - A `utilityProcess` connection host owns every `ssh` child and daemon
      connection.
    - The sandboxed renderer runs xterm.js plus the Accessible Text Surface, which
      gives the OS real text, selection and caret.

    The app has no native Node modules (no node-pty).

- **Daemon (`trcd`, Rust).** One per user per host, the same binary locally and
  remotely.
    - Registered with the OS per-user service manager: launchd LaunchAgent,
      systemd user unit, Windows per-user auto-start.
    - Owns PTYs (ConPTY on Windows), supervises processes, persists scrollback,
      and serves several attached clients at once.
    - Three subcommands:
        - `core`: the restartable supervisor.
        - `holder`: one per session; owns the PTY, the shell and the libghostty-vt
          emulator.
        - `bridge`: relays stdio to the core's socket.
    - A daemon crash or upgrade must not end sessions (US-2.5). So holders run
      apart from the upgradable core _and_ outside the service manager's kill
      scope: systemd kills the whole unit cgroup, launchd kills the job's process
      group, and ConPTY children die with their owner.
    - App↔daemon traffic is length-prefixed frames: JSON control messages (with
      TypeScript types generated from Rust by ts-rs) plus raw I/O.
- **Remote hosts (Linux x86_64/arm64, macOS).** The app connects with the
  system OpenSSH client and the user's SSH config and agent, uploads the daemon
  binary bundled in the app, verifies its SHA-256, installs it under the user's
  home without sudo or internet access, and talks to it through the SSH
  connection. One exec channel per host runs `trcd bridge` into the daemon's
  Unix socket, so this works even when SSH forwarding is disabled.
- **Detached daemon.** On Linux without systemd lingering, a user unit dies
  about 10 s after the last SSH session closes, so the daemon must then run
  detached, outside the user's systemd instance (US-2.4). Remote macOS without
  a GUI login also gets a detached daemon.

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

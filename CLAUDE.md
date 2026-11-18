# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

E1 shipped as v0.2.0 (M1 was v0.1.0), E2 as v0.3.0, E3 as v0.4.0 and E4 as
v0.5.0; 0.x releases are alpha builds, and 1.0.0 is the first official release
(D-43). E5 is in progress for v0.6.0: `docs/plans/epic-05-implementation-plan.md`
records its stories, and the E1 to E4 plans sit beside it. Usage is in `USER_GUIDE.md`. The monorepo holds
the Electron app (`apps/desktop`), the protocol package (`packages/protocol`),
the Rust crates (`crates/*`) and tooling (`tools/*`).

## Commands

- Full local gate: `pnpm check` (Prettier, Biome, document IDs, `tsc` per
  process, Vitest node and browser projects, `cargo fmt`, clippy, nextest).
- Lint only: `pnpm lint`. Format: `pnpm format`. Types: `pnpm typecheck`.
- UI messages: `pnpm --filter @trc/desktop i18n` after changing any
  `defineMessages`; `pnpm check` fails while they are stale.
- User guide: `pnpm docs:guide` after changing `USER_GUIDE.md`; it renders the
  in-app guide, `apps/desktop/resources/docs/index.html` (D-41), and
  `pnpm check` fails while that page is stale.
- Unit and component tests: `pnpm test`; one test:
  `pnpm exec vitest run <file> -t <name>`.
- Rust: `cargo nextest run --workspace`; one test: `cargo nextest run <name>`.
  The first build needs `tools/fetch-libghostty.sh` (verified libghostty-vt
  source) and Zig 0.17. `TRC_BLESS_FIXTURES=1` rewrites golden fixtures.
- Integration (needs `tools/test-hosts/up.sh`): `pnpm test:integration`. It
  builds the daemon bundle (`pnpm build:daemon`), then runs `pnpm test:daemon`, which runs the musl daemon tests as root in
  Ubuntu, Alpine and Rocky containers (Linux-only and other-user checks).
- macOS test host (E4, P-57): `tools/test-hosts/macos/up.sh`, after
  `tools/test-hosts/up.sh`, starts a tart VM on lima's user-mode network with
  SSH on `127.0.0.1:2230` only, and adds `trc-mac-gui` (LaunchAgent) and
  `trc-mac-nogui` (detached) to the test SSH config; the integration suites and
  `host-restart.spec.ts` then include them (`mac-logout.integration.test.ts`
  logs `trc-mac-gui` out, then reboots the VM), and `TRC_E2E_HOST=trc-mac-gui`
  runs the single-host e2e specs on one. `tools/test-hosts/macos/down.sh` deletes the
  VM (`--purge` also the base image). The x86_64 slice runs under Rosetta with
  `cargo nextest run --target x86_64-apple-darwin --workspace` (P-63).
- NFR measurements: `pnpm test:nfr` (needs the test hosts and the daemons;
  launches the app in the background); `TRC_NFR_HOST=local` runs the
  connection-host measurements on This computer instead of `trc-ubuntu`, and
  `node tools/nfr-report/nfr-report.ts` prints the run's table for
  `docs/verification/E5-nfr.md`.
- Soak (NFR-11, P-25): `pnpm test:soak` (needs the test hosts, the daemons and
  `tools/test-hosts/fetch-old-daemon.sh`); `TRC_SOAK_CYCLES` (1,000),
  `TRC_SOAK_APP_CYCLES` (50) and `TRC_SOAK_LOGOUT_CYCLES` (1,000) set the
  cycles, `TRC_SOAK_REBOOT_CYCLES` (100) the host restarts of the reboot soak,
  and `TRC_SOAK_HOST` the host of the ssh-level app quit and crash and of the
  flap scenarios. `launchd.soak.test.ts` soaks the LaunchAgent on This
  computer (a temporary agent, P-58) and, with the macOS test host, on
  `trc-mac-gui`. It runs for hours (the logout scenario alone takes about
  3.6 hours); each scenario file can run alone with
  `vitest run --project soak <file>`, and its sessions are reached through
  `docker exec` as well as ssh (`DOCKER_CONTEXT`, `colima-trc` by default).
- End to end: `pnpm test:e2e`. Accessibility tree: `pnpm test:ax` (needs the
  macOS Accessibility permission). Both build a test build
  (`pnpm --filter @trc/desktop build:test`, `TRC_TEST_BUILD=1`), which compiles
  in the P-14 seam (`TRC_TEST_*`); every test launch gets a scratch `TRC_HOME`; their live-terminal tests skip
  unless the test hosts are up and the daemons are built. Only launches that set
  `TRC_TEST_LOCAL_HOME` (a scratch home for its LaunchAgent plist) get This
  computer, whose daemon installs in their scratch `TRC_HOME` (P-58). Test launches open
  unseen (`TRC_TEST_BACKGROUND=1`, D-27): transparent, click-through, in the
  bottom-right corner, never focused. `pnpm test:ax` must take focus, so warn
  the owner before running it.
- App state lives in the TRC home, `~/.trc` (`config.json`, `hosts.json`, `sessions.json`), or
  `TRC_HOME` when set; hosts install the daemon under `~/.trc` unless the
  user moves a host's install location (US-1.4.3).
- Icons: `pnpm icons` renders `apps/desktop/resources/icons` from
  `tools/icons`. Packaging: `pnpm dist` (ad-hoc signed arm64 and x64 dmg and
  zip in `apps/desktop/dist`).
- Releases run entirely in GitHub Actions (`.github/workflows/release.yml`,
  P-21, D-42): `pnpm release <major|minor|patch> [--dry-run]` starts it with
  `gh` and watches it; it commits the version as `github-actions[bot]`, builds,
  runs `pnpm verify:artifact` on each architecture's runner, then tags, pushes
  and publishes. CI (`.github/workflows/ci.yml`) builds and unit-tests every
  push and PR, and the release commit.
- `pnpm install` also brands the development Electron.app (name, icon,
  ad-hoc re-signature) through `tools/dev-electron` (D-35), so menus and the
  About panel show the product in dev and test builds.
- Shortcuts: `docs/design/keymap.md` and `apps/desktop/src/shared/keymap.ts`
  must match (a test checks); every command runs through the renderer's
  dispatcher (D-36).
- The git hooks install with `pnpm install` into `.git/hooks`; a global
  `core.hooksPath` hook manager runs them. Never bypass hooks with
  `--no-verify`.

`docs/PRD.md` is the source of truth for requirements. Reference its IDs in
designs, code reviews and commits:

- Global requirements every epic must meet: `A11Y-*`, `SEC-*`, `NFR-*`.
- Epics `E1`–`E7`: incremental, usable deliverables; `E8` then prepares the
  general-availability release (1.0.0). Each epic's acceptance criteria is its
  list of user stories, `US-<epic>.<n>`.

`docs/TECH_STACK.md` records the chosen languages, libraries, tools, configs and
the decision log (`D-01`…). Keep the stack minimal: the PRD is the scope, so
add nothing it doesn't need. Record any new or changed dependency or tool in
`docs/TECH_STACK.md` first.

The implementation breakdown of each epic goes in
`docs/plans/epic-NN-implementation-plan.md`, not in the PRD. Its stories are
`ST-<n>` and its planning decisions `P-<nn>`, numbered on from the previous
epic's plan so every identifier stays unique. E5's plan is
`docs/plans/epic-05-implementation-plan.md`; keep its status table current.

Platforms arrive in this order (PRD §7.4): macOS desktop app plus Linux remote
daemon (E1–E3), macOS daemon for local sessions and macOS hosts (E4), Windows
desktop (E6), Linux desktop (E7). Don't build ahead for later platforms, and
don't make choices that block them (for example, never depend on
`ControlMaster`, which Windows OpenSSH lacks).

## What the product is

A desktop terminal manager. An Electron app (built the way VS Code is) shows a
session list on the left and the selected terminal in the center. Sessions
belong to a per-user **daemon** on each host, not to the app, so they survive
app quit, app crash, network loss and client reboot. After a host reboot, the
daemon respawns each session's shell below its saved scrollback when the app
next connects; it never re-runs commands.

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

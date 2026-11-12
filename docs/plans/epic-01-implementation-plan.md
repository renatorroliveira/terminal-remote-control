# Epic 1 implementation plan: accessible remote terminal, macOS app to Linux hosts

| Field  | Value                                                                                |
| ------ | ------------------------------------------------------------------------------------ |
| Status | v2: approved in planning on 2026-11-11, revised at the ST-1 spike gate on 2026-11-12 |
| Owner  | Renato Oliveira                                                                      |
| Scope  | PRD §9.1 (US-1.1 to US-1.14) plus every global requirement for what E1 delivers      |
| Inputs | [PRD.md](../PRD.md) v0.5, [TECH_STACK.md](../TECH_STACK.md) v1.2                     |

## 1. Context

The repository has only documentation so far: the PRD (v0.3) and the accepted tech stack. E1 is the first
shippable epic. It delivers a macOS Electron app in which a VoiceOver, Zoom or Voice Control user adds a Linux host
they reach with SSH keys, and runs, switches and manages terminal sessions there. The app installs a Rust daemon
(`trcd`) on the host over SSH. E1 must retire risks R1, R2, R9 and R10.

This plan breaks E1 into implementation stories (ST-0 to ST-21). It starts with the spikes the tech stack
requires (S1–S5) and builds the whole monorepo base from scratch. This session executes every story itself. The
only subagents are the two reviewers that run at the end of the epic.

## 2. Decisions confirmed in planning

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-01 | One Electron app with a folder per process: `apps/desktop/src/{main,preload,connection-host,renderer,shared}`. Inside each process, code is grouped by feature. Code shared across processes lives in `packages/protocol`.                                                                                                                                                                         |
| P-02 | 4 Rust crates: `trc-protocol` (serde types, frame codec, ts-rs export), `ghostty-vt-sys` (raw FFI, build.rs), `trc-vt` (safe wrapper and the `TerminalState` trait), `trcd` (binary: `core`, `holder`, `bridge`).                                                                                                                                                                                  |
| P-03 | libghostty-vt 1.0.x comes from its signed release tarballs (source plus deps). `tools/fetch-libghostty.sh` checks SHA-256 against a checked-in manifest and the minisign signature against the published key, and caches the result outside git. build.rs runs `zig build --system <deps> -Dtarget=<triple>` and never touches the network.                                                        |
| P-04 | Linux test hosts are sshd containers on a dedicated colima profile `trc` (Ubuntu 24.04, Alpine, Rocky 9, plus noexec-home and NSS-only-user variants). Ports are published to `127.0.0.1` only, and keys are generated per run.                                                                                                                                                                    |
| P-05 | Story 1 holds the spikes (S1, S2, S3a, S4, S5) and the decisions they produce. The plan is revised at the gate that ends it.                                                                                                                                                                                                                                                                       |
| P-06 | Spike code is throwaway and exempt from TDD. It lives in `spikes/<id>/`, is committed once as evidence, and is deleted at the gate. Only the findings, the decisions, the test hosts and the AX probe are kept.                                                                                                                                                                                    |
| P-07 | Strict TDD everywhere else: a failing test before every production change, including UI and glue code.                                                                                                                                                                                                                                                                                             |
| P-08 | Cadence: each story ends with all its checks green, then a commit on `main`, then the next story. The session pauses only at human checkpoints (§7) and on blockers (P-20).                                                                                                                                                                                                                        |
| P-09 | No per-story reviews. At the end of the epic, `code-reviewer` and `technical-auditor` review the full E1 diff in parallel. Every finding is fixed (test-first) or rejected with a written reason.                                                                                                                                                                                                  |
| P-10 | The remote is `github.com/renatorroliveira/terminal-remote-control` (added 2026-11-11, after planning). GitHub Actions workflows are written but run only on manual dispatch until the owner says otherwise. The local `pnpm check` plus the integration and e2e suites are the gate.                                                                                                              |
| P-11 | E1 builds are **ad-hoc signed** (`codesign -s -`, which Apple silicon and the fuse flip require) and not notarized. The PRD records an E1-only exception to SEC-04.1. SEC-04.2–4 still apply in full.                                                                                                                                                                                              |
| P-12 | App identity: name "Term Remote Control", bundle ID `dev.trc.desktop`, npm scope `@trc/*`. These are constants in one file, so OQ-5 is a one-line change.                                                                                                                                                                                                                                          |
| P-13 | E1 defers PRD §11.4 (user research) and §11.5 (VPAT), which the PRD records as an E1 note. Done means automated checks plus the owner's manual AT passes (§11.3).                                                                                                                                                                                                                                  |
| P-14 | SSH test seam: test builds accept `TRC_TEST_SSH_CONFIG` and `TRC_TEST_KNOWN_HOSTS`, passed as `-F` and `UserKnownHostsFile`. An electron-vite define compiles the seam out of release builds, and a release-artifact test asserts it is absent.                                                                                                                                                    |
| P-15 | The daemon also builds and runs nextest natively on macOS, for development only. Linux-only code sits behind `cfg(target_os = "linux")`. Integration and e2e tests run the musl binary in the containers. E1 ships Linux daemons only.                                                                                                                                                             |
| P-16 | E1 flow control is backpressure: E1 has one attached client per session, and when its credit runs out the holder pauses PTY reads. Programs block as in any terminal, and `INPUT` never queues behind `OUTPUT` (NFR-03). E2 adds "never block", `Resync` and `ReadRows`, together with multiple clients (US-2.6). No line is ever skipped in E1, so A11Y-02.3 and A11Y-03 hold without a backfill. |
| P-17 | In E1, `trcd bridge` starts the core detached (double fork plus `setsid`, under a lock) when its socket is absent. E2 adds service-manager registration and kill-scope isolation.                                                                                                                                                                                                                  |
| P-18 | App state (hosts, settings, UI state) is JSON files in `userData`, mode 0600. Writes are atomic (temp file, fsync, rename), and reads are validated with zod. Audio cues are tones generated with Web Audio, with no sound assets. User docs are hand-written accessible HTML bundled in the app and opened from the Help menu.                                                                    |
| P-19 | macOS builds are separate arm64 and x64 artifacts. The x64 smoke test runs under Rosetta 2 on an Apple silicon Mac.                                                                                                                                                                                                                                                                                |
| P-20 | Autonomy: the session develops, verifies, commits and proceeds through every story without asking. The PRD is the tie-breaker for every open design decision. The owner is asked only about a decision that would go against the PRD or change a P-xx decision. The ST-1 gate pause is replaced by recording the findings and continuing, unless a spike forces such a decision.                   |

ST-0 records P-03, P-04, P-10, P-11, P-14, P-16 and P-17 in the TECH_STACK decision log (D-14 onward), because they
change tools or behavior. The rest are process decisions and stay in this document.

## 3. Working agreement (applies to every story)

1. **Read** the PRD sections for the story's IDs and the TECH_STACK sections it touches.
2. **Red.** Write the failing tests that encode the acceptance criteria: Rust unit and integration, Vitest unit
   and browser with axe, and Playwright e2e. Run them and watch them fail.
3. **Green.** Write the smallest implementation that passes.
4. **Refactor.** Keep cognitive complexity ≤ 10, one responsibility per module, and public items before private
   ones. Doc comments (JSDoc or rustdoc) on every public item, and no other comments. Types are immutable
   (`readonly`, `as const`, no `any`).
5. **Gate.** `pnpm check` is green, plus the story's integration and e2e suites. No `biome-ignore` or `#[expect]`
   without a reason.
6. **Docs.** Before adding any dependency or tool, record it in TECH_STACK. Update the CLAUDE.md commands, the
   README and this plan's status table (§10).
7. **Commit.** Conventional Commits with the PRD IDs, a body of at most 3 paragraphs wrapped at 72 columns, and
   `git -P commit --author="$(git config user.name) (Agentic) <$(git config user.email)>"`. No Co-Authored-By.
8. **Continue** to the next story.

## 4. Repository layout

```
apps/desktop/                     @trc/desktop
  electron.vite.config.ts         main, preload, renderer; connection host via ?modulePath
  electron-builder.yml            arm64 + x64 dmg/zip, ad-hoc sign, fuses
  src/main/                       app lifecycle, windows, menus, IPC handlers, theme relay, store
  src/preload/                    contextBridge API, MessagePort hand-off
  src/connection-host/            ssh/, bootstrap/, hosts/, mux/, lifecycle reducer
  src/renderer/
    app/                          shell, regions, keymap, palette, announcer, notifications, settings
    features/hosts/               add host, host key, errors, progress
    features/sessions/            session tree, create, manage
    terminal/                     xterm registry, ATS, input encoder, announcer feed, review, find
    ui/                           RAC wrappers, tokens, themes
  src/shared/                     IPC contract, ids, pure helpers
  resources/bin/                  askpass, known-hosts, bootstrap.sh
  resources/daemon/               linux-x64, linux-arm64 trcd + manifest.json (generated)
  resources/docs/                 user docs (HTML)
  test/e2e/                       Playwright _electron specs
packages/protocol/                @trc/protocol: framing, generated types, zod schemas
crates/{trc-protocol,ghostty-vt-sys,trc-vt,trcd}/
protocol/fixtures/v1/             shared JSON and binary fixtures
tools/ax-probe/                   Swift CLI reading AXUIElement attributes
tools/test-hosts/                 Dockerfiles, compose file, up/down scripts, test CA, user setup
tools/fetch-libghostty.sh         + libghostty.manifest (version, SHA-256, minisign key)
docs/plans/  docs/spikes/  docs/design/  docs/verification/
```

## 5. Stories

Each story lists the PRD IDs it serves, what it builds, and its exit criteria ("Done when"). Under P-07, every
bullet is preceded by its tests.

### Phase 0 — Plan

**ST-0 Write the plan and record the planning decisions**

- Write this document to `docs/plans/epic-01-implementation-plan.md`.
- In CLAUDE.md, replace the `docs/DELIVERY_PLAN.md` reference with `docs/plans/epic-NN-implementation-plan.md`.
- TECH_STACK:
    - Add D-14 onward (§2).
    - Update the §9.1 layout and the §10 E1 row (P-16, P-17).
    - Add the dev tools minisign, colima and the docker CLI.
- PRD: add the E1 exceptions for SEC-04.1 (P-11) and for §11.4/§11.5 (P-13), and bump the version to v0.4.
- Done when no undefined PRD or decision IDs are left in the three docs (scripted check), and `docs(plan): ...` is
  committed.

### Phase 1 — Spikes and decisions

**ST-1 Spikes S1, S2, S3a, S4, S5 and the decisions they drive** (D-02, R1, R2, R9, R10, US-1.2, US-1.3, US-1.11,
NFR-09)

Toolchain, all non-destructive:

- `rustup self update && rustup update stable` (1.99.1), plus the musl targets for x86_64 and aarch64.
- `brew install zig minisign`, then `brew link docker`.
- `colima start trc --vm-type vz --vz-rosetta --cpu 4 --memory 6`. This is a new profile; the `default` profile is
  left untouched.
- `cargo install --locked cargo-zigbuild cargo-nextest`.
- pnpm 12 through corepack.

Kept in their final location:

- `tools/test-hosts`: the sshd images, a test CA for certificates, a jump-host pair, the noexec-home variant, the
  NSS-only user (libnss-extrausers), and `up`/`down` scripts.

The spikes:

- **S1 libghostty-vt** (`spikes/s1`).
    - Fetch and verify 1.0.x, build static libraries for aarch64-macos and for musl on x86_64 and aarch64, then
      bindgen once.
    - A tiny Rust binary links the library through cargo-zigbuild. Run it in the Alpine and Ubuntu containers;
      x86_64 runs under Rosetta.
    - Record the stripped size.
    - VT round trip: a corpus covering vim, htop, CJK, emoji ZWJ sequences, combining marks and the alternate
      screen. Each sample goes through ghostty and its formatter, then into `@xterm/headless` with
      unicode-graphemes. Compare row text, cursor position and cell widths.
    - Query replies (DA1/DA2, CPR, XTVERSION, OSC 10/11) through the effect callbacks.
    - A toy holder (PTY, bash, emulator) measures PSS idle and with 10,000 lines of scrollback.
    - **Decides D-02:** keep libghostty-vt or switch to alacritty_terminal.
- **S2 ATS** (`spikes/s2`, with the probe promoted to `tools/ax-probe`).
    - Electron 45 with sandbox and app://, xterm 6 with WebGL, and an ATS prototype: role=textbox, EditContext,
      one text node per row, selection mirrored both ways, and a caret at the cursor.
    - The Swift probe reads AXRole, AXValue, AXSelectedText, AXSelectedTextRange, AXSelectedTextMarkerRange,
      AXInsertionPointLineNumber, AXBoundsForRange and AXFocused.
    - Then the owner's manual checks: VoiceOver name and role, VoiceOver's read-selection command, Speak
      Selection, Look Up, Services, Zoom following the caret, Dictation, and Japanese IME.
    - **Retires R1.** Records the attribute mapping and confirms or revises the ATS design.
- **S3a local flood** (on the S2 prototype).
    - A local child process floods the terminal (`yes`, a 1 GB `cat`, `find /`) with VoiceOver on.
    - Measure renderer frame time and the AX update rate.
    - Set initial values for the AT cadence (about 4/s), the review page (500 lines), the selection cap (5,000
      lines) and the flood threshold.
    - Prototype echo suppression.
    - **Partly retires R2 and R9.**
- **S4 ssh** (`spikes/s4`), against the containers.
    - The KnownHostsCommand helper with a nonce, for an unknown and for a changed host key.
    - The askpass FIDO notice. This needs the owner's security key; without one, it falls back to a unit-level
      check and a manual check at release.
    - The stderr corpus for every US-1.3 case: no agent, agent empty, key rejected, passphrase key not loaded,
      PIN, expired certificate, DNS failure, unreachable host, timeout, jump-host failure.
    - `SSH_AUTH_SOCK` when the app is launched from Finder.
    - The corpus files are kept under `docs/spikes/s4/`.
- **S5 bootstrap** (`spikes/s5`).
    - A POSIX sh prototype on Ubuntu, Alpine/busybox and Rocky: HELLO, `uname` mapping, checksum tool detection,
      `head -c`/`dd` upload, `mkdir` lock, atomic rename.
    - noexec detection (exit 126), cleanup on failure, `getent` for the NSS-only user.
    - **Retires R10's mechanism.**

**Gate.**

- Write `docs/spikes/S1.md` to `S5.md`.
- Update TECH_STACK: D-02 outcome, ATS mapping, tuned values. Update the PRD wherever a tuned value appears
  (A11Y-03.2, A11Y-04.7).
- Revise ST-2 onward in this plan.
- Commit the prototypes (`chore(spikes): ...`), then delete `spikes/` and commit the findings
  (`docs(spikes): ...`).
- Continue to ST-2 (P-20). Stop only if a spike result contradicts the PRD or a P-xx decision.

### ST-1 gate outcome (2026-11-12)

Findings are in [docs/spikes](../spikes/). No result contradicts the PRD or a P-xx decision. Changes to the stories
below:

- **S1:** D-02 stands. ST-4 turns on DEC mode 2027 by default, lifts the 10,000-byte scrollback cap, formats
  snapshots with `EXTRAS_ALL` and `TRIM=false`, and links from a directory holding only the `.a`.
- **S2:** D-22 replaces EditContext with a `contenteditable` ATS that cancels every edit, because EditContext broke
  Zoom caret tracking. ST-10 adds the four selection and caret rules from [S2](../spikes/S2.md) and resolves the hint,
  which Chromium does not expose as `AXHelp`.
- **S3a:** the cadence, flood hold (256 KiB/s) and 5,000-line selection cap are confirmed; ST-16 measures the review
  page.
- **S4:** D-21 adds a generated wrapper ssh config so `ProxyJump` connections get the same options. ST-8 builds it and
  the classifier from the [S4 corpus](../spikes/s4/). No FIDO key was available, so the touch flow moves to ST-21.
- **S5:** ST-7 removes the directories it created when an install fails.

### Phase 2 — Foundation

**ST-2 Monorepo scaffold and quality gates** (NFR-13 groundwork, SEC-01 for the dev server)

Root configuration:

- `package.json`: `packageManager` pnpm 12, engines Node 24, and the scripts `check`, `lint`, `format`,
  `typecheck`, `test`, `test:integration`, `test:e2e`, `test:ax`, `gen`, `build`, `dist`.
- `pnpm-workspace.yaml`: `minimumReleaseAge` and `onlyBuiltDependencies`.
- `.gitignore`, `.editorconfig`, `.prettierrc.json`, `.prettierignore`, `biome.json` and `tsconfig.base.json`,
  exactly as in TECH_STACK §9.
- `lefthook.yml` and commitlint. The pre-commit hook also rejects staged `.claude/` paths and absolute home-directory
  paths, so no agent or machine-specific file reaches git.
- `.claude/` and every other agent or machine-specific file stay out of git (`.gitignore`). No editor or agent
  hook is part of the project; lefthook formats staged files.

Cargo workspace:

- `Cargo.toml` with workspace lints and a release profile: LTO, `codegen-units=1`, strip.
- `rust-toolchain.toml`: 1.99.1, the musl targets, clippy and rustfmt.
- `rustfmt.toml`, `clippy.toml`, and `.cargo/config.toml` aliases.

Packages and tooling:

- Skeletons of every package and crate, each born from a first failing test.
- `tools/doc-ids` gets its Vitest tests and joins `pnpm check`.
- electron-vite config for the four entries. The dev server binds `127.0.0.1`.
- One tsconfig per process.
- Vitest projects: node-unit, browser (Chromium plus axe), and node-integration.
- Playwright `_electron` config.
- `tools/ax-probe` builds through `swift build`, and a smoke test checks it.
- CI workflow files, run only on manual dispatch (P-10).

Docs:

- A `style:` commit formats the existing docs with Prettier.
- README: prerequisites and commands. CLAUDE.md: the command list.

Done when `pnpm check` is green on the skeleton, `cargo nextest run` is green, and the hooks reject a bad commit
message.

**ST-3 Protocol v1** (US-1.4.6, NFR-12 groundwork, NFR-03)

- `trc-protocol`:
    - A frame codec `u32 len | u8 kind | u32 stream | payload` with a maximum frame size and a 32 KiB OUTPUT
      chunk.
    - Control messages: Hello/Welcome/Incompatible, Ping/Pong, ListSessions, ListProfiles, Create, Rename,
      Reorder, Stop, Restart, Close, Attach/Attached, Detach, Resize, SessionEvent, Error. `Close` is added for
      US-1.10.4.
    - `SessionInfo` with the US-1.9 states, and `ShellProfile` (§8).
    - Version negotiation over the range N..N−1.
    - ts-rs export to `packages/protocol/src/generated/`.
- `@trc/protocol`:
    - A streaming decoder that routes on the 9-byte header, and an encoder.
    - Zod schemas typed `z.ZodType<Generated>`.
    - Credit accounting helpers.
- `protocol/fixtures/v1/`, checked by insta snapshots in Rust and by Vitest.
- `pnpm gen` regenerates the types. `check` fails when the generated files differ from the committed ones.

**ST-4 VT engine crates** (US-1.11.1–2, NFR-10, SEC-06.3)

- Production `fetch-libghostty.sh` and manifest.
- `ghostty-vt-sys`:
    - build.rs maps each Rust target to a Zig triple, builds into OUT_DIR and caches by version and target.
    - Checked-in bindings.
- `trc-vt`, the `TerminalState` trait:
    - feed, resize with reflow, VT snapshot through the formatter;
    - title, pwd, cursor, alternate screen and bell events;
    - query replies returned as bytes for the PTY;
    - a configurable scrollback limit;
    - title and other echo-back reports disabled.
- Every terminal: DEC mode 2027 on by default, `SCROLLBACK_MAX_BYTES` at `SIZE_MAX` with the line limit, foreground
  and background colors for OSC 10/11, and an XTVERSION callback (S1).
- Snapshots use the VT formatter with `EXTRAS_ALL` and `TRIM=false` (S1).
- build.rs links from a directory that holds only the static library (S1).
- Tests reuse the S1 corpus, including a check that the replay into `@xterm/headless` matches.

### Phase 3 — Daemon

**ST-5 `trcd holder`** (US-1.7, US-1.9.1–2, US-1.10.2–3, US-1.11.3, P-16)

- PTY through portable-pty and shell spawn:
    - login shell detection: `$SHELL`, then `getent passwd`, then `/bin/sh`;
    - `arg0` `-zsh`;
    - cwd;
    - environment rules (§8): TERM, COLORTERM, TERM_PROGRAM, nothing inherited, user overrides.
- The emulator receives all output and answers terminal queries.
- Output to the attached client with credits and backpressure.
- Resize.
- Exit code or signal, start time and last-output time.
- Stop: SIGHUP, then SIGTERM, then SIGKILL after the grace period.
- Restart keeps the scrollback and adds a marker line.
- The cwd comes from `/proc/<pid>/cwd` on Linux, falling back to OSC 7.
- Tests: native unit tests on macOS, and integration in Linux containers.

**ST-6 `trcd core` and `trcd bridge`** (US-1.5.1, US-1.9, US-1.10, SEC-01, SEC-02, SEC-04.4, SEC-08, NFR-09)

- Core:
    - `~/.trc/run/core.sock` with mode 0600 in a 0700 directory. Paths too long for a socket fall back to
      `/tmp/trc-<uid>/`.
    - A `peer_cred` uid check.
    - The integrity check: owner and mode of the binary, its version directory and the install root.
    - Session registry and order.
    - ListProfiles: login shell, `/etc/shells`, and a PATH probe.
    - Holders are spawned by re-exec, and each has a socket in `run/holders/<id>.sock` using the same codec with
      internal messages.
    - SessionEvent fan-out.
- Logging: JSON through tracing-appender, mode 0600, rotated. A `Sensitive<T>` type prints `[redacted]`.
- Bridge:
    - Relays stdio to the core socket.
    - Starts the core detached (P-17).
    - `--version` prints the version and SHA-256.
- Tests:
    - A no-listener test: no TCP or UDP sockets on any `trcd` process (`/proc/net` plus `ss`).
    - A test that rejects a peer from another uid.
    - A PSS measurement against NFR-09.

**ST-7 Bootstrap, install and the daemon bundle** (US-1.4.1–4, US-1.4.6, SEC-04.2–3, SEC-07, R10)

- Production `resources/bin/bootstrap.sh`:
    - umask 077, nonce HELLO, OS and architecture, installed versions, checksum tool;
    - `UPLOAD`/`RUN`, lock, exact-size read, verify, `chmod 700`, rename into `versions/<sha256>/`, `--version`;
    - the noexec message;
    - a trap that cleans up on any failure.
- Per-host install root, with `~/.trc` as the default.
- `pnpm build:daemon` runs cargo zigbuild for both musl targets and writes `resources/daemon/*` plus
  `manifest.json` (SHA-256, version).
- Version comparison: never downgrade, and a newer daemon means "update the app".
- A test matrix over Ubuntu, Alpine and Rocky, the noexec home and the NSS-only user. Each test checks that
  nothing is left behind after a failure, including the directories the script created (S5).

### Phase 4 — App plumbing

**ST-8 Connection host and SSH transport** (US-1.1.2–4, US-1.2 mechanism, US-1.3 classification, US-1.5, NFR-07,
SEC-03)

- The utilityProcess entry.
- An argument builder with exactly the arguments in TECH_STACK §7, plus the wrapper config of D-21: a `Host *`
  block with the same options, then `Include ~/.ssh/config` and `Include /etc/ssh/ssh_config`, passed with `-F`.
  In test builds, the P-14 seam replaces the user include with `TRC_TEST_SSH_CONFIG` and sets
  `UserKnownHostsFile` from `TRC_TEST_KNOWN_HOSTS`.
- Checks: `ssh -V` ≥ 8.5, and `ssh -G` for the effective settings.
- Production `askpass` and `known-hosts` helpers.
- A nonce filter for startup-file noise.
- The bootstrap driver for ST-7, with progress events.
- Host key flow:
    - the prompt event;
    - on accept, append to `known_hosts`, hashed when `hashknownhosts yes`, then reconnect;
    - refuse a changed key.
- The stderr classifier, built on the S4 corpus: text patterns, then `ssh-add -l` (exit 2 no agent, 1 empty),
  encrypted `IdentityFile`s missing from `ssh-add -L`, expired `CertificateFile`s (`ssh-keygen -L`), and a named
  host that is not the target for jump failures. The FIDO touch event. HOSTKEY lines are stripped from shown
  details.
- One channel per host, multiplexing every session. `INPUT` and `CONTROL` frames go first.
- Ping every 5 s with a 15 s timeout.
- The connection lifecycle as a discriminated-union reducer.
- The MessagePort hand-off, with output batched for about 5 ms.
- An app logger with redaction, mode 0600.
- Tests: unit tests (args, classifier, reducer, nonce), and integration against the containers (Vitest node
  project).

**ST-9 App shell** (US-1.6.5, A11Y-01.5, A11Y-06.6, A11Y-07.1/3, A11Y-08.3, A11Y-11.12, NFR-06, NFR-13, SEC-01)

- Main process:
    - single-instance lock;
    - the `app://` protocol handler and CSP;
    - `sandbox`, `contextIsolation`, no `nodeIntegration`;
    - the menu bar, including Help;
    - the window title (session, host, app);
    - the display-setting relay through `nativeTheme` and `systemPreferences` into `data-*` attributes;
    - the P-18 JSON store.
- Preload `contract.ts`, with zod validation in `ipcMain.handle`.
- Renderer:
    - React root, I18nProvider, react-intl with precompiled messages, `<html lang>`.
    - CSS Modules and tokens in `@layer`s.
    - The 4 themes, and focus-ring tokens.
    - A colorjs.io contrast test over every pair of tokens.
- e2e: the window is interactive within 2 s.

**ST-10 Terminal view and ATS: milestone M1, a working terminal** (A11Y-01.1/3, A11Y-04.1–5, A11Y-05.2–4,
A11Y-06.1–5, A11Y-09.3–4, US-1.11.3, SEC-06)

- xterm registry outside React: WebGL, with a DOM fallback, unicode-graphemes and fit.
- Resize goes to the daemon.
- Credits returned from xterm's write callbacks.
- The renderer swallows terminal queries.
- Production ATS:
    - name, description and state;
    - row text nodes for the viewport, the overscan and the selection up to the cap;
    - `contenteditable` input that cancels every `beforeinput` and sends IME text on `compositionend` (D-22);
    - a key encoder ported from xterm's `Keyboard.ts` (MIT, with attribution);
    - selection mirrored both ways, with the S2 rules: the DOM leads during a pointer drag, a selection the app did
      not set is mirrored rather than replaced, and typing clears the selection and returns the caret in one
      change;
    - minimal `replaceData` row edits;
    - a caret at the cursor, whose text-marker bounds drive Zoom and the IME window;
    - the accessibility hint (A11Y-01.2): verify what VoiceOver speaks for `aria-describedby`, else fold it into
      the name behind the verbosity setting;
    - transparent text aligned to the grid for pointer reading;
    - the S3a cadence.
- Look Up and Services.
- Tab focus mode and "send next key".
- Distinct focused and unfocused cursors.
- A dev-only host entry connects to a container.
- Tests:
    - e2e: type `echo hi` and read the result through the ATS DOM;
    - `pnpm test:ax`: AX attribute assertions through the probe, gated on the Accessibility permission.

### Phase 5 — Features

**ST-11 Workspace layout and commands** (US-1.6.1/3, A11Y-05.1–8, A11Y-07.5–6, A11Y-11.2/3/5/7/10/11,
A11Y-12.1/3)

- Three named regions: sidebar, terminal and status bar.
- Region cycling.
- The APG window splitter: pointer, keyboard, a setting, collapse, and a persisted width.
- Reflow at 320 CSS px, where the sidebar becomes a toggleable panel. Text spacing is tolerated.
- Status bar: connection, daemon state, Tab mode, mute.
- A persistent notification list.
- An announcer service: `ariaNotify`, with a polite live region as the fallback, rate-limited and merged per
  session.
- A keymap registry:
    - every binding is rebindable;
    - collision checks against control codes and OS or VoiceOver shortcuts;
    - **`docs/design/keymap.md`** fixes the final key map. The proposed Ctrl+F6 clashes with macOS "move focus to
      floating window", and the design must resolve that.
- The command palette (RAC Autocomplete plus ListBox), where every action is registered.
- Context-menu infrastructure: Shift+F10, the Menu key, Ctrl+click.

**ST-12 Hosts** (US-1.1.1/5/6, US-1.2, US-1.3, US-1.4.5–7, A11Y-11.6/8/9, A11Y-12.2)

- The add-host dialog:
    - `Host` entries from `~/.ssh/config` and its `Include`s, parsed in the connection host;
    - free-form `[user@]host[:port]`;
    - a user field with `autocomplete="username"`;
    - recent hosts offered again;
    - Test connection.
- The host key dialog: no time limit, and the fingerprint is copyable.
- Error messages with a remedy, copyable details, and an assertive announcement when the error blocks the task.
- "Touch your security key for <host>".
- Bootstrap steps announced politely.
- Upgrade confirmation when sessions are running. A "newer daemon, update the app" message.
- Forget host, with a confirmation that names what it deletes.

**ST-13 Session tree and lifecycle** (US-1.6.2/4, US-1.7, US-1.8, US-1.9.3–4, US-1.10, A11Y-09.1–2, A11Y-11.9)

- The in-house `role=tree`:
    - level, posinset, setsize and expanded on every row;
    - arrow keys, type-ahead, Home and End;
    - host groups that show their state and collapse;
    - each item's name or description carries the state as text plus an icon, its badges and its position;
    - last activity on demand.
- New session through a shortcut, a button, the menu and the palette, with the host and cwd rules.
- "New session…": host, profile, cwd, name and environment.
- Opening a session:
    - Enter or click opens it, and moving focus does not switch;
    - next and previous shortcuts;
    - an announcement on open;
    - the scroll position kept per session.
- Rename (OSC title until the user renames), stop with a grace period, restart with a marker, close with a
  confirmation, duplicate.
- Move up and Move down, plus drag.
- Exited sessions are kept. Auto-close is off by default.

**ST-14 Output announcements and screen-reader mode** (A11Y-01.4, A11Y-02.1–7, A11Y-10.2, R9, NFR-04)

- Logical-line assembly from the xterm buffer.
- Shell echo of typed input is suppressed.
- Flood summary and resume.
- Mute shortcut.
- On the alternate screen, the line at the cursor.
- Background sessions stay silent, and nothing is re-queued after stop-speech.
- AT detection through `app.isAccessibilitySupportEnabled()` and its change event, plus a setting and a
  command-line flag. The change is announced.

**ST-15 Terminal I/O features** (US-1.12, A11Y-04.6–7, A11Y-07.2/4/6/8, A11Y-08.1/2/4, SEC-06.1/2/4)

- Exact copy with logical lines; over the cap, an announcement.
- Paste: Cmd+V and the context menu, bracketed paste, and a confirmation for multiple lines that states the line
  count.
- Links:
    - OSC 8 through `linkHandler`;
    - URL and path detection;
    - modifier+click;
    - a "list links" command;
    - the target is shown when it differs from the text.
- OSC 52 off by default, enabled per host. Clipboard reads always refused.
- Control characters stripped from titles and announcements.
- Minimum contrast 4.5:1, including the dim-text fix.
- Font size and zoom up to 200%, resizing the PTY.
- Line-height and letter-spacing.
- Cursor shape and thickness.
- Blink: off under reduce motion, and stops after 5 s without input.
- Visual bell: at most 3 flashes per second, with alternatives.
- A pinned viewport with an announced "new output below" indicator.

**ST-16 Review mode and find** (A11Y-03.1–8, US-1.13)

- Option+F2 opens review mode:
    - a paged, read-only multi-line text field with the S3a page size;
    - seamless re-paging, and start and end of the whole buffer;
    - it opens at the cursor line;
    - a "new output" notice once per burst, and jump to end;
    - Shift selection and copy within the cap.
- Find (Cmd+F):
    - case-sensitive and regex options;
    - "match 3 of 17" announced;
    - the match highlighted with A11Y-04 contrast;
    - in review mode, the review caret moves to the match;
    - Escape returns focus.

**ST-17 Connection loss** (US-1.14, US-1.5.5, A11Y-12.2, NFR-07)

- Disconnected state for every session on the host, announced.
- Input refused, not buffered: "Disconnected — input not sent", shown and announced.
- A Reconnect action lists the sessions and re-attaches.
- Tests: `docker pause` and killing ssh, with detection in ≤ 30 s.

**ST-18 Accessibility help, settings and user docs** (A11Y-01.2, A11Y-10.1/3/4/5, A11Y-12.4, NFR-10)

- Option+F1 opens accessibility help, which lists the shortcuts for the current context. Also in the Help menu.
- A searchable settings page:
    - verbosity, hints, flood threshold, audio cues (volume and off);
    - minimum contrast, cursor and blink;
    - Tab mode, F6 option;
    - scrollback size, stop grace period, auto-close, paste confirmation;
    - OSC 52 per host.
- Bundled HTML user docs and a VoiceOver quick-start. No instruction relies on a sensory characteristic.

### Phase 6 — Verification, packaging, release

**ST-19 Fidelity and NFR verification** (US-1.11.5, S3b, NFR-02/03/04/05/06/07/09/10, SEC-08)

- Program-matrix e2e on Ubuntu: vim, neovim, less, top, htop, nested tmux, git, ssh, the Python REPL.
- S3b at 100 ms RTT (`tc netem`, using the `NET_ADMIN` capability in the test container only) to tune the credit
  window.
- Timing harness in test builds for NFR-02, NFR-03 and NFR-04.
- Scale: 100 sessions per host, and 25 hosts as 25 users in one container.
- Startup time, daemon PSS, and the scrollback default and maximum.
- Canary strings appear in no log.
- Results go in `docs/verification/E1-nfr.md`.

**ST-20 Packaging** (SEC-01.3, SEC-04.2, P-11, P-19)

- electron-builder produces arm64 and x64 dmg and zip, ad-hoc signed.
- Fuses: release build and test build.
- The daemon resources and their manifest.
- Third-party notices built from `pnpm licenses list` and `cargo metadata`.
- Release-artifact tests:
    - `@electron/fuses read`;
    - no listening sockets after launch, connect and create (`lsof -iTCP -sTCP:LISTEN`, UDP);
    - the test seam and remote debugging are absent.
- x64 smoke test under Rosetta.

**ST-21 Release gate and epic review** (PRD §9 done, §11.1–3, §11.6)

- Run the full suites: axe on every view, keyboard e2e for every US, contrast, AX snapshots.
- Write `docs/verification/E1-manual-at.md`, the scripted passes for VoiceOver, Zoom, Voice Control, Dictation,
  Full Keyboard Access and Spoken Content. The owner runs them.
- A SEC-01 to SEC-08 checklist.
- The FIDO touch flow (US-1.3.2) joins the manual checklist, because no security key was available at ST-1.
- Run `code-reviewer` and `technical-auditor` in parallel on every commit after the tech stack commit
  (`docs(stack): add tech stack research and decisions`). Fix every finding test-first.
- Final pass over CLAUDE.md, README, TECH_STACK and PRD status.
- Commit, and tag `v0.1.0` locally.

## 6. Traceability

| PRD item       | Stories                             | PRD item              | Stories                         |
| -------------- | ----------------------------------- | --------------------- | ------------------------------- |
| US-1.1         | ST-8, ST-12                         | A11Y-01               | ST-9, ST-10, ST-14, ST-18       |
| US-1.2, US-1.3 | ST-1 (S4), ST-8, ST-12              | A11Y-02               | ST-14                           |
| US-1.4         | ST-1 (S5), ST-7, ST-8, ST-12        | A11Y-03               | ST-16                           |
| US-1.5         | ST-6, ST-8                          | A11Y-04               | ST-1 (S2), ST-10, ST-15, ST-16  |
| US-1.6         | ST-9, ST-11, ST-13                  | A11Y-05               | ST-10, ST-11                    |
| US-1.7–US-1.10 | ST-5, ST-6, ST-13                   | A11Y-06               | ST-9, ST-10                     |
| US-1.11        | ST-1 (S1), ST-4, ST-5, ST-10, ST-19 | A11Y-07               | ST-9, ST-11, ST-15              |
| US-1.12        | ST-15                               | A11Y-08               | ST-9, ST-15                     |
| US-1.13        | ST-16                               | A11Y-09               | ST-10, ST-13                    |
| US-1.14        | ST-17                               | A11Y-10               | ST-14, ST-18                    |
| SEC-01, SEC-02 | ST-2, ST-6, ST-8, ST-20             | A11Y-11               | ST-11–ST-13, ST-18              |
| SEC-03         | ST-8                                | A11Y-12               | ST-11, ST-12, ST-17, ST-18      |
| SEC-04, SEC-07 | ST-6, ST-7, ST-20                   | NFR-02–07, 09, 10, 13 | ST-9, ST-19                     |
| SEC-06, SEC-08 | ST-4, ST-6, ST-10, ST-15, ST-19     | R1, R2, R9, R10       | ST-1, ST-10, ST-14, ST-19, ST-7 |

SEC-05 has nothing to store on the daemon side in E1, because persistence arrives in E3. App-side JSON files are
0600 (P-18).

## 7. Human checkpoints

| When       | The owner does                                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ST-1       | Grant the Accessibility permission to the terminal running the AX probe. Run the S2 and S3a VoiceOver, Zoom, Dictation and IME checks from my script. Say whether a FIDO key is available. Give the go-ahead at the gate. |
| ST-10 (M1) | Optional quick VoiceOver check on the first live terminal.                                                                                                                                                                |
| ST-21      | Run the manual AT scripts (§11.3 for macOS) and confirm or reject the release gate.                                                                                                                                       |

## 8. Verification

- `pnpm check`: Prettier check, Biome, `tsc` for each process, Vitest unit and browser tests, protocol generation
  diff, `cargo fmt --check`, clippy (deny) and nextest.
- `pnpm test:integration`: starts `tools/test-hosts` on colima, then runs the daemon and the connection host
  against Ubuntu, Alpine and Rocky over real ssh.
- `pnpm test:e2e`: Playwright `_electron` against the test build and the containers, with axe on every view,
  keyboard-only flows for every US and ARIA snapshots.
- `pnpm test:ax`: AX probe assertions for A11Y-04 and A11Y-06. Requires the Accessibility permission.
- `pnpm dist` followed by the artifact tests: fuses, no listeners, no test seam, the daemon manifest.
- Manual: `docs/verification/E1-manual-at.md`.

## 9. Re-plan triggers

- S1 fails on musl, or round-trip fidelity fails: switch to alacritty_terminal (D-02 fallback). ST-4 and ST-5
  are re-estimated.
- S2 shows that Chromium does not expose the ATS selection or caret as required: stop and redesign the ATS with
  the owner before ST-10.
- S3a, or S3b in ST-19, cannot hold NFR-04 with VoiceOver: revisit the cadence and page size, and update the PRD
  values.
- Any requirement turns out to need something outside the PRD scope or the stack: ask before adding it.

## 10. Status

| Story | Status      | Commit |
| ----- | ----------- | ------ |
| ST-0  | Done        | —      |
| ST-1  | Done        | —      |
| ST-2  | Done        | —      |
| ST-3  | Not started | —      |
| ST-4  | Not started | —      |
| ST-5  | Not started | —      |
| ST-6  | Not started | —      |
| ST-7  | Not started | —      |
| ST-8  | Not started | —      |
| ST-9  | Not started | —      |
| ST-10 | Not started | —      |
| ST-11 | Not started | —      |
| ST-12 | Not started | —      |
| ST-13 | Not started | —      |
| ST-14 | Not started | —      |
| ST-15 | Not started | —      |
| ST-16 | Not started | —      |
| ST-17 | Not started | —      |
| ST-18 | Not started | —      |
| ST-19 | Not started | —      |
| ST-20 | Not started | —      |
| ST-21 | Not started | —      |

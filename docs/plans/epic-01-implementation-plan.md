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

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-01 | One Electron app with a folder per process: `apps/desktop/src/{main,preload,connection-host,renderer,shared}`. Inside each process, code is grouped by feature. Code shared across processes lives in `packages/protocol`.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| P-02 | 4 Rust crates: `trc-protocol` (serde types, frame codec, ts-rs export), `ghostty-vt-sys` (raw FFI, build.rs), `trc-vt` (safe wrapper and the `TerminalState` trait), `trcd` (binary: `core`, `holder`, `bridge`).                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P-03 | libghostty-vt 1.0.x comes from its signed release tarballs (source plus deps). `tools/fetch-libghostty.sh` checks SHA-256 against a checked-in manifest and the minisign signature against the published key, and caches the result outside git. build.rs runs `zig build --system <deps> -Dtarget=<triple>` and never touches the network.                                                                                                                                                                                                                                                                                                                            |
| P-04 | Linux test hosts are sshd containers on a dedicated colima profile `trc` (Ubuntu 24.04, Alpine, Rocky 9, plus noexec-home and NSS-only-user variants). Ports are published to `127.0.0.1` only, and keys are generated per run.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| P-05 | Story 1 holds the spikes (S1, S2, S3a, S4, S5) and the decisions they produce. The plan is revised at the gate that ends it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P-06 | Spike code is throwaway and exempt from TDD. It lives in `spikes/<id>/`, is committed once as evidence, and is deleted at the gate. Only the findings, the decisions, the test hosts and the AX probe are kept.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| P-07 | Strict TDD everywhere else: a failing test before every production change, including UI and glue code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P-08 | Cadence: each story ends with all its checks green, then a commit on `main`, then the next story. The session pauses only at human checkpoints (§7) and on blockers (P-20).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P-09 | No per-story reviews. Before the E1 release, four reviewers run in parallel over every commit after the tech stack commit, split by area: `code-reviewer` on the Rust daemon and protocol, `code-reviewer` on the TypeScript app and tools, `technical-auditor` on security and PRD compliance across everything, and `technical-auditor` on the release pipeline and packaging. Every critical or high finding is fixed test-first and the reviews repeat until none remain; other findings are fixed or rejected with a written reason. A fix that would go against the PRD or an owner decision (P-xx, D-xx) is confirmed with the owner first (owner, 2026-11-13). |
| P-10 | The remote is `github.com/renatorroliveira/terminal-remote-control` (added 2026-11-11, after planning). Since M1 (owner), GitHub Actions builds and unit-tests every push to `main` and every pull request, and releases are GitHub Releases that the release workflow cuts (P-21). The local `pnpm check` plus the integration and e2e suites remain the gate.                                                                                                                                                                                                                                                                                                        |
| P-11 | E1 builds are **ad-hoc signed** (`codesign -s -`, which Apple silicon and the fuse flip require) and not notarized. The PRD records an E1-only exception to SEC-04.1. SEC-04.2–4 still apply in full.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P-12 | App identity: name "Terminal Remote Control" (TRC; OQ-5 resolved), bundle ID `dev.trc.desktop`, npm scope `@trc/*`. These are constants in one file, so OQ-5 is a one-line change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| P-13 | E1 defers PRD §11.4 (user research) and §11.5 (VPAT), which the PRD records as an E1 note. Done means automated checks plus the owner's manual AT passes (§11.3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P-14 | SSH test seam: test builds accept `TRC_TEST_SSH_CONFIG` and `TRC_TEST_KNOWN_HOSTS`, read ahead of the user's `~/.ssh/config` and known_hosts files, never in their place (owner, M1), and `TRC_TEST_INSTALL_ROOT`, where hosts added in the run install. An electron-vite define compiles the seam out of release builds, and a release-artifact test asserts it is absent.                                                                                                                                                                                                                                                                                            |
| P-15 | The daemon also builds and runs nextest natively on macOS, for development only. Linux-only code sits behind `cfg(target_os = "linux")`. Integration and e2e tests run the musl binary in the containers. E1 ships Linux daemons only.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P-16 | E1 flow control is backpressure: E1 has one attached client per session, and when its credit runs out the holder pauses PTY reads. Programs block as in any terminal, and `INPUT` never queues behind `OUTPUT` (NFR-03). E2 adds "never block", `Resync` and `ReadRows`, together with multiple clients (US-2.6). No line is ever skipped in E1, so A11Y-02.3 and A11Y-03 hold without a backfill.                                                                                                                                                                                                                                                                     |
| P-17 | In E1, `trcd bridge` starts the core detached (double fork plus `setsid`, under a lock) when its socket is absent. E2 adds service-manager registration and kill-scope isolation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P-18 | App state (hosts, settings, UI state) is JSON files in the TRC home (`~/.trc`, or `TRC_HOME`; owner, M1), mode 0600. Writes are atomic (temp file, fsync, rename), and reads are validated with zod. Audio cues are tones generated with Web Audio, with no sound assets. User docs are hand-written accessible HTML bundled in the app and opened from the Help menu.                                                                                                                                                                                                                                                                                                 |
| P-19 | macOS builds are separate arm64 and x64 artifacts. The release workflow smoke-tests each on a native GitHub runner, `macos-15` and `macos-15-intel` (owner, 2026-11-13); Rosetta 2 on an Apple silicon Mac remains the local fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P-20 | Autonomy: the session develops, verifies, commits and proceeds through every story without asking. The PRD is the tie-breaker for every open design decision. The owner is asked only about a decision that would go against the PRD or change a P-xx decision. The ST-1 gate pause is replaced by recording the findings and continuing, unless a spike forces such a decision.                                                                                                                                                                                                                                                                                       |
| P-21 | Releases run entirely in GitHub Actions (owner, 2026-11-13; D-42). The release workflow starts from GitHub's Run workflow button or `pnpm release <bump>`. It sets the version and commits it as `github-actions[bot]`, re-runs CI, builds both Linux musl daemons on Ubuntu, packages the arm64 and x64 dmg and zip on macOS with those daemons, and smoke-tests each package on its native runner. Only then does it tag, push, publish `TRC v<version>` with notes and SHA-256 sums, and move `main` to the next `-dev` version. A dry run builds and checks without pushing or publishing.                                                                         |

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
- `protocol/fixtures/v1/`, checked by golden-file tests in Rust and by Vitest.
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

- PTY on rustix (D-23) and shell spawn:
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
- Outcome: `trcd holder --socket <path>` serves one session on a private socket. portable-pty was replaced
  (D-23) after concurrent spawns crashed on musl. On macOS, concurrent `/dev/ptmx` opens can fail with XNU's
  internal `EREDRIVEOPEN` (-6), so the open is retried a bounded number of times.

**ST-6 `trcd core` and `trcd bridge`** (US-1.5.1, US-1.9, US-1.10, SEC-01, SEC-02, SEC-04.4, SEC-08, NFR-09)

- Core:
    - The core creates its files with umask 077 and gives holders back the umask it inherited from the login
      session. A holder socket that refuses connections is stale and removed.
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
- Outcome: the core adopts live holders after a crash (each holder introduces its spec and name), and one core runs
  per user under a `flock`. `trcd core --detach` gives the bridge its double fork. The Linux-only checks run as root
  in the three distro containers through `pnpm test:daemon`. Copies of the binary in tests are made with `cp`,
  because an in-process copy left a write descriptor that concurrent forks inherited (`ETXTBSY`).

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

- Outcome: the bootstrap driver (`connection-host/bootstrap/`) is built and tested here, against every test host
  over real ssh, instead of in ST-8. ST-8 wires it to the connection's ssh process and the progress events. The
  driver keeps reading the host's error when the host stops reading mid-upload.

**ST-8 Connection host and SSH transport** (US-1.1.2–4, US-1.2 mechanism, US-1.3 classification, US-1.5, NFR-07,
SEC-03)

- The utilityProcess entry.
- An argument builder with exactly the arguments in TECH_STACK §7, plus the wrapper config of D-21: a `Host *`
  block with the same options, then `Include ~/.ssh/config` and `Include /etc/ssh/ssh_config`, passed with `-F`.
  In test builds, the P-14 seam includes `TRC_TEST_SSH_CONFIG` ahead of the user's config and lists
  `TRC_TEST_KNOWN_HOSTS` first in `UserKnownHostsFile`, so accepted test keys go there.
- Checks: `ssh -V` ≥ 8.5, and `ssh -G` for the effective settings.
- Production `askpass` and `known-hosts` helpers.
- A nonce filter for startup-file noise.
- The bootstrap driver from ST-7, wired to the ssh process, with progress events.
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

- Outcome: `connection-host/` holds `ssh/` (arguments, wrapper config, helpers, classifier, known_hosts),
  `bootstrap/`, `connection/` (the `HostConnection`, lifecycle reducer, pinger, ssh tools) and `port/` (router,
  request validation, output batching). Main forks it as a utility process and hands a MessagePort to every page
  load; the renderer's receiver is in `renderer/connection/`. Integration tests cover every US-1.2 and US-1.3 case
  live, including the jump host, and a paused host detected as dead within 30 s.

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

- Outcome: the window title is the renderer's `document.title`, from `windowTitle()`. Menus carry Help with the
  user guide and accessibility help (Option+F1) as commands for ST-18. The `JsonStore` is ready for the stores of
  ST-11–ST-13; no file uses it yet. Browser tests dedupe React, because Vite's late pre-bundling of react-intl loaded
  a second copy.

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

- Outcome: `renderer/terminal/` holds `TerminalView` (xterm, addons, focus, fit, credit), `AtsSurface` (rows,
  selection mirroring, caret), `attachInput` (keys, `beforeinput`, IME, paste), the key encoder, the query filter,
  the S3a scheduler and `SessionLink` (create, attach, input, credit, resize). `renderer/connection/host-client.ts`
  correlates daemon requests over the MessagePort. AT detection is an IPC pair over
  `app.isAccessibilitySupportEnabled()`. Edit carries Look Up (Ctrl+Cmd+D) and Speech.
- The test host panel (`renderer/dev/`) stood in for ST-12 and ST-13 until the second M1 round replaced it with
  the known-hosts list; test builds (`build:test`, which `test:e2e` and `test:ax` run) still ask for the install
  location. Tab focus mode is Ctrl+Shift+M and "send next key" is armed through
  `sendNextKey()`; ST-11's keymap binds both for good.
- While a program tracks the mouse, the ATS lets the pointer through to xterm; otherwise the wheel scrolls the
  buffer. xterm's helper textarea is out of the tab order and hands focus to the ATS, which sends the DECSET 1004
  focus reports.
- The live e2e test found a bootstrap bug: a version directory whose binary printed no version broke `HELLO`. The
  script now lists only binaries whose SHA-256 matches their directory and that report as `trcd`, and an upload
  replaces a binary that no longer matches.
- Open with the owner: the M1 VoiceOver check, including whether VoiceOver speaks the `aria-describedby` hint
  (A11Y-01.2), and a `pnpm test:ax` run from a terminal that holds the Accessibility permission.

**ST-10 follow-up: the owner’s first M1 test round** (A11Y-04, A11Y-06.3, A11Y-07, US-1.6, US-1.7.1, US-1.8.1)

- Bugs the owner found, each with a test that fails without its fix:
    - Pointer selection collapsed at once: xterm's link-layer canvas sat above the ATS, because xterm's internal
      z-indexes shared the host's stacking context. The canvas now has its own stacking context below the ATS.
    - Zoom tracked a point left of the cursor: the ATS letter spacing came from a canvas measurement in the wrong
      font (−3.7 px). The ATS now measures a run of glyphs in its own font, its rows take the cell height, and the
      AX probe test checks that the caret bounds sit on the cursor cell.
    - Found along the way: every glyph was drawn in 10px sans-serif (D-26).
- The owner's improvements:
    - A 350 px sidebar that scrolls on its own beside the terminal area, collapsing into a toggled panel under
      720 px (A11Y-07.5). The grid is at most 120 columns, centered (D-24).
    - The session tree of ST-13, first part: hosts and sessions with their state as text, the APG keys,
      type-ahead, Enter or click to open, and New session on the open session's host. Rename, stop, close and
      reorder stay in ST-13. The read model is the TECH_STACK §4.4 Zustand store.
    - Midnight and the theme preference in View > Theme (D-25, PRD v0.6), stored in `settings.json` (P-18).
    - Embedded fonts at 14 px (D-24).
- Test builds open behind the focused app (D-27); e2e and AX runs install under a scratch location on the test
  host and remove it afterwards.

**ST-10 follow-up: the owner’s second M1 test round** (US-1.1.1, US-1.2, US-1.5, US-1.7.1, A11Y-06, A11Y-07, NFR-02)

- Layout: 20 px between the terminal's border, where its focus ring is drawn, and its text; the sidebar is 400 px
  and collapses under 800 px.
- Typing latency review, measured from keydown to the ATS update against a local test host:
    - Two fixes (D-28): output now posts with a leading edge (arrival 9.4 → 7.4 ms p50), and the echo of typing
      skips the AT cadence (AT on: 111.7 → 17.6 ms p50, and every keystroke now updates).
    - The exec channel stays: a raw TTY measured about 10 ms slower, and there are no Nagle stalls at 50 ms RTT.
- The sidebar has two areas:
    - At the top, the open sessions by host, then the connected host a new session starts on and New session.
    - At the bottom, the known hosts, each with an icon-only connection button: green connected, red disconnected
      or failed, amber while connecting or waiting on a host key. Its name says what pressing it does (connect,
      disconnect, cancel, review the host key) and its description gives the state, with a failure's details.
    - Below the list, a field adds a host as an SSH alias or `[user@]host[:port]` (US-1.1.1, first part). Known
      hosts persist in `hosts.json` (P-18). The ST-12 dialog, `~/.ssh/config` suggestions, Test connection and
      Forget host are still to come.
    - The unknown host-key question sits under the list, and its badge moves focus to it (US-1.2).

**ST-10 follow-up: the owner’s third M1 test round** (US-1.1, US-1.3, A11Y-07.1, A11Y-07.2, P-14)

- A failed connection opens a modal alert over the dimmed app: what went wrong and how to fix it, one message per
  US-1.3 cause, then the copyable details in a read-only field, and OK. Focus returns to where it was. This is the
  first part of the ST-12 error messages; the assertive announcement comes with ST-11's announcer.
- The connection badges are a presence set that differs by shape as well as color: a hollow ring when
  disconnected or failed, a half-filled ring while busy, a filled dot when connected.
- New session, Add host and OK are primary buttons: a `primary` fill with `primaryText` and a `primaryBorder` edge
  that keeps 3:1 against the page in every theme (Midnight: white on `#004d1a`, with the `#00ad2c` edge).
- The test seam no longer hides the user's SSH config: a corporate host behind a `ProxyCommand` timed out in a
  test build. P-14 now reads the test config and known_hosts ahead of the user's. A live run against the owner's
  Amazon Linux 2023 arm64 host connected in 2.4 s on first install, and its typing echo measured 31.5 ms p50 and
  37 ms p95 through the proxy.
- Found along the way: e2e launches without a profile shared the developer's own and exited as second instances
  while the developer's app ran, so every test launch now gets a scratch profile. Adding a host no longer clears
  what the user typed while the add was saving.

**ST-10 follow-up: the owner’s fourth M1 test round, with Claude Code on a remote host** (US-1.10.7, US-1.11,
A11Y-04, A11Y-05, A11Y-07.1)

- The PTY kept its creation size: xterm's resize event also carries `colsChanged` and `rowsChanged`, and the
  connection host's strict schema refused every resize after the first. The renderer now sends only columns and
  rows, and an e2e test checks `stty size` after a window resize.
- Shift+Enter: the daemon's emulator answers the kitty keyboard query, so Claude Code turned the protocol on, but
  the key encoder ignored it. The renderer now follows the flags and encodes the disambiguate level (D-30).
- The holder marks every PTY `IUTF8`, so erase removes whole characters. A running core keeps spawning holders
  from its own binary until it restarts.
- A pointer selection dragged past the top or bottom edge scrolls the terminal and grows with it, faster the
  farther the pointer is.
- Buttons: every non-primary button is light text on `#333333` with a `#8c8c8c` edge, and every enabled button
  shows the pointer.
- A session that exits with code 0 closes (PRD v0.7, D-29); if it was open, focus moves to New session.

**ST-10 follow-up: the owner’s fifth M1 round, closing M1 as v0.1.0** (US-1.1, US-1.4.5, US-1.6, US-1.7.1,
A11Y-04, A11Y-06, A11Y-07.1)

- The terminal cursor is a block in the border green, drawn from the start (D-32), and the selection is white text
  on `#006b24`, never inverted.
- The app is named Terminal Remote Control (OQ-5, P-12), with the Triad logo and icon set generated by
  `tools/icons` (D-31).
- `config.json` and `hosts.json` live in the TRC home, `~/.trc` or `TRC_HOME` (D-33). Hosts always install under
  `~/.trc`, so the add-host form is one field with Add host to its right. The app package's `productName` names the
  profile folder, and the old `@trc/desktop` profile migrates once.
- The sidebar has an APG window splitter (300 to 800 px, 400 by default) persisted in `config.json`, and one
  section per host. A connected host's + button starts a session there, and its name toggles the section. Only the
  open or hovered session has a border.
- The app connects to every known host at launch; a failure there leaves the host disconnected without a dialog.
- Packaging and releases (ST-20 in part, D-34): electron-builder builds the ad-hoc signed dmg and zip for both
  architectures, and `pnpm release` cuts GitHub Releases. CI builds and unit-tests every push and pull request
  (P-10, D-16). `USER_GUIDE.md` documents the feature set.

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

As built:

- `docs/design/keymap.md` fixes the key map. Region cycling is Command+F6 and Shift+Command+F6, because macOS takes
  the PRD's proposed Control+F6 (A11Y-05.2). `src/shared/keymap.ts` holds the defaults and the binding rules
  (A11Y-05.5, A11Y-05.6), and a test keeps the two in step.
- One renderer dispatcher matches every shortcut, so send-next-key passes any of them to the process; the View and
  Terminal menus show only the Command shortcuts (D-36). Rebinding is supported by the keymap; the settings page
  that edits bindings, and the plain-F6 option, arrive with ST-18.
- The status bar shows the open session's host and daemon, the Tab focus mode and mute toggles, and the
  notification count. Host connections, losses and failures are announced (A11Y-12.2) and losses and failures stay
  in the notification list. Mute is per session and takes effect with ST-14's output announcements.
- The command palette lists every command, host action and session. Context menus open on sessions, host sections
  and host rows. Enter on the splitter, or Control+Command+S, hides the sidebar, and `config.json` keeps it hidden.
- Two bugs found on the way: a bare modifier keydown spent an armed send-next-key, and any shell re-render
  re-attached the terminal frames and blurred the focused terminal.

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

As built:

- Add host is a combobox that offers recent addresses, then the `Host` names of `~/.ssh/config` and its `Include`s
  (read in the main process, the P-14 seam file first), with an optional user field (`autocomplete="username"`)
  below. Add host stays to the right of the field. While the suggestions are open, the combobox hides the rest of the
  window from assistive technology, as the APG combobox does.
- The host key question is a modal alert dialog with the fingerprint in a read-only, selectable field; Escape
  rejects. Each connection step and a security-key touch show in the host's state and are announced.
- Host actions (context menu and palette): test the connection, change the install location (US-1.4.3; the add
  flow still installs to `~/.trc` without asking, as the owner chose at M1) and Forget, which confirms and names
  what it removes and what stays. A `noexec` home gets its own failure message pointing at the install location.
- US-1.4.7 needs no confirmation in E1: an upload installs the new version beside the old one, and the running core
  keeps serving, with its sessions, until it stops. The status bar shows the version that runs.

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

As built:

- The session list is one in-house `role="tree"` with flat `aria-level`, `aria-posinset` and `aria-setsize`
  rows. A host row holds its + button with `tabindex="-1"`: pointer users click it, and keyboard users press
  Command+T or use the row's context menu. Session rows describe their host and carry a "new output" badge for
  output that arrived while they were hidden.
- Command+T, Shift+Command+T, Shift+Command+] and [ are in the keymap and the new Session menu (D-36). New
  session goes to the open session's host, then the last-used host, then the first connected one. It starts in the
  home folder; the setting to start in the focused session's folder arrives with ST-18.
- Rename, Stop, Restart, Duplicate, Move up and down, drag and Close (with a confirmation) go through the daemon's
  requests. The New session dialog lists the host's profiles. Stop uses the daemon's grace period until ST-18 adds
  the setting, and auto-close on clean exit stays on until ST-18's switch.

**ST-14 Output announcements and screen-reader mode** (A11Y-01.4, A11Y-02.1–7, A11Y-10.2, R9, NFR-04)

- Logical-line assembly from the xterm buffer.
- Shell echo of typed input is suppressed.
- Flood summary and resume.
- Mute shortcut.
- On the alternate screen, the line at the cursor.
- Background sessions stay silent, and nothing is re-queued after stop-speech.
- AT detection through `app.isAccessibilitySupportEnabled()` and its change event, plus a setting and a
  command-line flag. The change is announced.

As built:

- Each terminal has an output announcer (D-37). Once output settles (100 ms, at most 250 ms after it starts), it
  reads the logical lines from a marker at the cursor's line, removes the shell echo of what was typed, and speaks
  them in the session's announcer group, which joins waiting output line after line.
- More than 20 lines in a second starts a flood; the summary is spoken once output pauses for 500 ms. ST-18's
  settings page makes the threshold a setting.
- In the alternate screen the announcer reads the cursor line when the cursor moves or the line changes, and
  nothing while the program hides the cursor (DECTCEM).
- Only the open, unmuted session speaks, and only in screen-reader mode. Output from other times is never spoken
  later, nor is the screen a session restores on attach. Any key press drops output still waiting to be spoken.
- Screen-reader mode is `auto`, `on` or `off`: `screenReaderMode` in `config.json`, set from three palette entries
  until ST-18, or `--screen-reader-mode=` for one launch. `auto` follows Chromium's accessibility support. The
  terminal keeps the slower AT cadence whenever Chromium serves assistive technology, even with the mode forced
  off.
- The live e2e test speaks `echo` output without its echo. R9 still needs the owner's VoiceOver check (S3a), with
  the other manual passes in ST-21.

**ST-15 Terminal I/O features** (US-1.12, A11Y-04.6–7, A11Y-07.2/4/6/8, A11Y-08.1/2/4, SEC-06.1/2/4)

- Exact copy with logical lines; over the cap, an announcement.
- Paste: Cmd+V and the context menu, bracketed paste, and a confirmation for multiple lines that states the line
  count.
- Links (US-1.12.3, US-1.12.4):
    - OSC 8 through `linkHandler`;
    - URL detection; plain file paths wait for E5's local sessions (owner, 2026-11-13);
    - Cmd+click (Ctrl+click on other platforms);
    - a "list links" command;
    - any scheme the OS opens, always behind a confirmation that shows the target, unless the target starts with
      a trusted prefix from `accept_urls.json` in the TRC home; the confirmation can trust the link's origin.
- OSC 52 off by default, enabled per host (kept in `hosts.json`; the switch appears only on ST-18's settings page,
  owner's choice). Clipboard reads always refused.
- Control characters stripped from titles and announcements.
- Minimum contrast 4.5:1, including the dim-text fix.
- Font size and zoom up to 200%, resizing the PTY: Command+=, Command+- and Command+0 change only the terminal font
  (owner's choice); the View menu's page zoom moves to Control+Command+=, - and 0.
- Line-height and letter-spacing.
- Cursor shape and thickness.
- Blink: off under reduce motion, and stops after 5 s without input.
- Bell: a status bar indicator for a few seconds, announced, and a badge on a background session's row; nothing
  flashes (owner's choice), so A11Y-08.2's limit holds. The sound joins ST-18's audio cues.
- A pinned viewport with an announced "new output below" indicator.

As built (links first, by the owner's request on 2026-11-13):

- Links (D-38): Command+click (Control+click elsewhere) on a detected URL of any scheme or an OSC 8 hyperlink, and
  Shift+Command+O ("List links") for the keyboard. Every link asks first with its full address, unless it starts
  with a prefix in `accept_urls.json`; the dialog can trust the link's `scheme://host`. The main process refuses
  script and content schemes. Test builds log opened links to `TRC_TEST_OPENED_LINKS` instead of opening them.
- Plain-text file paths are not detected: on a remote host they name files the Mac can't open. They wait for local
  sessions in E5; OSC 8 `file:` links still open after the confirmation.
- Copy puts xterm.js's selection on the clipboard, soft-wrapped rows joined, whole even past the 5,000-line cap,
  which is announced. Paste turns line breaks into Return, wraps bracketed paste without any bracket sequence of
  its own, and asks first, with the text and the line count, for more than one line. Shift+F10, the Menu key and
  right-click open a native context menu: Copy, Paste, List Links and Look Up.
- OSC 52 writes reach the clipboard (through the main process, at most 1 MiB) only for a host with
  `allowClipboardWrites` in `hosts.json`, and each write is announced; reads are never answered. Titles and every
  announcement lose their control characters (SEC-06.4).
- Dim text keeps the full 4.5:1 floor through pnpm patches on xterm.js's two renderers (D-39).
- Command+=, Command+- and Command+0 set every terminal's text size from 50% to 200%, kept in `config.json` and
  announced; the PTY follows. Window zoom moved to Control+Command+=, - and 0, because Option+Command+= and - are
  macOS Zoom's (the plan first named those).
- `terminalAppearance` in `config.json` sets line height, extra letter spacing, the cursor's shape and bar width, and
  blinking; ST-18's settings page edits it. A blinking cursor stops after 5 seconds without input and never blinks
  under Reduce motion. xterm.js never draws SGR 5 blinking text.
- The bell shows "Bell" in the status bar for 3 seconds and is announced; a background session's row gets a "bell"
  badge until it opens. Nothing flashes.
- A scrolled-back viewport stays put (xterm.js already pins it); the first output below shows a "New output below"
  button, which jumps to the end, and is announced once.
- Fixed on the way: Add host's suggestions now narrow as the user types (US-1.1.1).

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

As built:

- Option+F2 opens a read-only `<textarea>` over the terminal (D-40), named "Review <session>, <host>", with the caret
  on the cursor's line and a 500-line page that re-pages within 50 lines of an edge. Command+Up and Command+Down
  (Control+Home and End) reach the buffer's start and end; the end reloads new output. Output while it is open
  never moves it and is announced once until the user goes to the end. Option+F2 or Escape returns to the terminal.
- Command+F opens a find bar above the terminal: it searches the logical lines from the most recent match, Return
  steps to older matches and Shift+Return to newer ones, with Match case and Regular expression toggles. The match
  is selected in the terminal (the selection colors meet A11Y-04) or in review mode, and "Match 3 of 17" is shown
  and announced. Escape returns focus to the terminal or review mode.
- Braille output and routing come with the native text field; the owner checks them in ST-21's manual passes.

**ST-17 Connection loss** (US-1.14, US-1.5.5, A11Y-12.2, NFR-07)

- Disconnected state for every session on the host, announced.
- Input refused, not buffered: "Disconnected — input not sent", shown and announced.
- A Reconnect action lists the sessions and re-attaches.
- Tests: `docker pause` and killing ssh, with detection in ≤ 30 s.

As built:

- A lost or failed connection keeps the host's sessions in the tree, each named "<session>, Disconnected", and
  the host's loss is announced assertively and listed in the notifications (A11Y-12.2). A disconnect the user
  asked for still closes the host's terminals.
- The host's terminals are named "<session>, <host>, disconnected" and refuse every keystroke and paste without
  buffering it. Each refusal shows "Disconnected — input not sent" over the terminal and announces it assertively,
  merged per session. Mouse and focus reports are dropped silently.
- The host's Connect button is the Reconnect action. Once connected, the app lists the sessions again and
  re-attaches every open terminal: the screen resets, the daemon sends the session's screen again, and that
  restored screen is not spoken, as on the first attach. Credit owed to the old stream is dropped. E2 adds
  reconnecting on its own.
- Tests: unit and component tests for the model, controller, registry, link, view and shell, and an e2e that
  kills the app's ssh, checks the Disconnected names, the refusal and its announcement, reconnects and types
  again. The `docker pause` integration test from ST-8 covers detection within NFR-07.

**ST-18 Accessibility help, settings and user docs** (A11Y-01.2, A11Y-10.1/3/4/5, A11Y-12.4, NFR-10)

- Option+F1 opens accessibility help, which lists the shortcuts for the current context. Also in the Help menu.
- A searchable settings page:
    - verbosity, hints, flood threshold, audio cues (volume and off);
    - minimum contrast, cursor and blink;
    - Tab mode, F6 option;
    - scrollback size, stop grace period, auto-close, paste confirmation;
    - OSC 52 per host.
- Bundled HTML user docs and a VoiceOver quick-start. No instruction relies on a sensory characteristic.

As built:

- Option+F1 (and Help, then Accessibility Help) opens a dialog with a table of the shortcuts for where focus was
  (terminal, review mode or session list) and one for everywhere, each command showing its chord in force, plus
  the User guide and VoiceOver quick start buttons.
- The user guide is `USER_GUIDE.md` rendered to `resources/docs/index.html` by `tools/user-docs` (D-41), shown in
  a sandboxed window with no preload from the `app://docs` host, with a script-free CSP; web links open in the
  browser. The VoiceOver quick start is one of its sections, so both copies stay the same.
- Command+, opens the settings page: a search field that filters as the user types and says how many settings
  are shown, and sections for speech, sound, display, keyboard, sessions and hosts. Beyond the list above it has
  screen-reader mode, the theme, text size, line height, letter spacing, where new sessions start and the shortcut
  editor. Minimum contrast offers 4.5 and 7 to 1. Each change applies at once and lands in `config.json`, field by
  field; `settings:set` takes only known settings in range.
- The shortcut editor records the next key press, refuses one that breaks a keymap rule or belongs to another
  command, and resets to the default; the menus drop their accelerators while it listens. Plain F6 is a switch.
- Sound cues are Web Audio tones, off by default, with a volume: the bell, connecting, a lost or failed connection
  and refused input, each under 3 seconds and beside its announcement.
- Help, settings and the palette return focus by hand, which fixed focus falling to the page when help closed
  over the New host field.
- Tests: unit and component tests for each part, axe on both dialogs, and e2e tests for help and the guide window,
  the settings page with a theme change, and rebinding with the menus following. Playwright cannot deliver a
  Command+letter press that a menu owns to an Electron page on macOS, so recording such a chord is part of the
  owner's hands-on check.

### Phase 6 — Verification, packaging, release

**ST-19 Fidelity and NFR verification** (US-1.11.5, S3b, NFR-02/03/04/05/06/07/09/10, SEC-08)

Everything here runs against the local test hosts (P-04), so it stays a local suite, `pnpm test:nfr`. Each check
fails when its PRD target is breached, and `docs/verification/E1-nfr.md` records the results with the machine and
conditions.

- Program-matrix e2e on Ubuntu: vim, neovim, less, top, htop, nested tmux, git, ssh, the Python REPL.
- S3b at 100 ms RTT (`tc netem`, using the `NET_ADMIN` capability in the test container only) to tune the credit
  window.
- A timing harness in test builds (P-14):
    - NFR-02: keystroke to echo, p95 ≤ the SSH round trip + 10 ms.
    - NFR-03: Ctrl+C under `yes` and a 1 GB `cat` reaches the process, p95 ≤ 100 ms, and the UI stays
      interactive.
    - NFR-04: output to the announcement request, ≤ 500 ms when idle. The speech itself is checked in ST-21's
      VoiceOver pass.
- NFR-05 scale: 100 sessions on one host, and 25 hosts as 25 users in one container; state changes reach the app,
  p95 ≤ 250 ms.
- NFR-06: window interactive ≤ 2 s (E1's part). NFR-07: a dead connection detected ≤ 30 s (E1's part).
- NFR-09: idle daemon ≤ 30 MB RSS and ≤ 0.5% CPU, ≤ 10 MB per session beyond scrollback. NFR-10: the 10,000-line
  default and the 100,000-line maximum, with memory bounded.
- SEC-08: canary strings typed, printed and set in the environment appear in no app or daemon log.

As built (2026-11-13):

- `pnpm test:nfr` runs a Vitest half (`apps/desktop/test/nfr/*.nfr.test.ts`, the connection host in Node over real
  ssh) and a Playwright half (`ui.spec.ts`, the test build). Each measurement is appended with its target to
  `apps/desktop/nfr-results/results.jsonl`, and `tools/nfr-report` prints it as a table. Results and findings are in
  [E1-nfr.md](../verification/E1-nfr.md).
- The test hosts gain `trc-latency` (100 ms, `tc netem`, `NET_ADMIN`) and `trc-scale-01` to `25` (25 users on one
  sshd with a raised `MaxStartups`); `up.sh` recreates every container so none keeps an old key.
- The program matrix is `test/e2e/programs.spec.ts`, part of `pnpm test:e2e`.
- Test builds report each terminal write's arrival and parse time (`write-timing.ts`, P-14), so NFR-02 is measured
  to the echo parsed in the app, with the next display frame recorded beside it.
- Tuned: the credit window is 1 MiB (S3b). Fixed: a silent ssh exit now has details (US-1.3.1).
- NFR-02 misses by about 1 ms on a sub-millisecond link, from Electron's port delivery between the renderer and the
  utility process; the owner accepted it for E1 on 2026-11-13, and the UI test guards it at 15 ms.

**ST-20 Packaging and the release workflow** (SEC-01.3, SEC-04.2, P-11, P-19, P-21)

Already built (M1, D-34): electron-builder's ad-hoc signed arm64 and x64 dmg and zip, the fuses, and the bundled
daemons with their manifest. Still to build:

- The main window refuses navigation and new windows (`will-navigate`, `setWindowOpenHandler`), like the guide
  window (SEC-01).
- Third-party notices generated from `pnpm licenses list` and `cargo metadata`, bundled in the app and checked for
  staleness.
- Release-artifact checks, `pnpm verify:artifact <TRC.app>`, run on the packaged app:
    - `@electron/fuses read` matches §4.5;
    - the asar holds no test seam (`TRC_TEST_*`);
    - launched with `--remote-debugging-port` and `--inspect`, the app opens no listener;
    - after launch, `lsof` shows no listening TCP socket and no UDP socket;
    - the bundled daemons match the manifest's SHA-256 and size.
      Locally, with the test hosts up, the same check also connects and creates a session first.
- `.github/workflows/release.yml` (P-21, D-42), started by hand with `bump` (major, minor, patch) and `dry-run`:
    1. **prepare** (Ubuntu, `main` only): the version from the last `v*` tag, the notes, the version commit as
       `github-actions[bot]` through the repository's hooks, kept as a git bundle for the later jobs.
    2. **checks**: `ci.yml` as a reusable workflow, on that commit.
    3. **daemon** (Ubuntu): both musl daemons and `manifest.json`.
    4. **package** (`macos-15`): `pnpm dist` with those daemons: the 4 packages.
    5. **smoke** (`macos-15` for arm64, `macos-15-intel` for x64): `pnpm verify:artifact` on each architecture's
       own app.
    6. **publish** (Ubuntu, the only job with `contents: write`; skipped on a dry run): tag, push `main` and the tag
       atomically (it fails if `main` moved), publish `TRC v<version>` with the notes, the 4 packages and
       `SHA256SUMS.txt`, fetch an asset anonymously to confirm the release is public, then commit and push the
       next `-dev` version.
- Actions stay pinned by SHA, and no secret but the job's `GITHUB_TOKEN` is used. `pnpm release <bump>
[--dry-run]` becomes a shortcut that starts the workflow with `gh` and watches it.
- Done when a dry run on `main` passes on both runners and its artifacts launch on this Mac.

As built (2026-11-13):

- `refuseNavigation` keeps the main window on its page; `refuseRemoteDebugging` strips the DevTools switches in
  release builds; `readTestSeam` is the one reader of `TRC_TEST_*`, which release bundles no longer contain.
- `pnpm verify:artifact` checks a packaged app: ad-hoc signature, fuses, no seam, the notices, the daemons against
  the manifest and the app version, and no TCP or UDP socket after a background launch with every debugging switch.
  It found the DevTools listener and the seam names in v0.1.0.
- `tools/notices` writes `THIRD_PARTY_NOTICES.txt` (93 components); `pnpm check` and CI fail while it is stale.
- `.github/workflows/release.yml` and the `release-commit` action carry the release commit between jobs as a git
  bundle; `ci.yml` is reusable and runs cargo with `--locked`. The first dry run passed in 13 minutes, with "may
  ship" on `macos-15` and `macos-15-intel`, and its arm64 package passed the same check on this Mac.

**ST-21 Release gate and epic review** (PRD §9 done, §11.1–3, §11.6)

- Run the full suites: axe on every view, keyboard e2e for every US, contrast, AX snapshots.
- Write `docs/verification/E1-manual-at.md`, the scripted passes for VoiceOver, Zoom, Voice Control, Dictation,
  Full Keyboard Access and Spoken Content. The owner runs them.
- A SEC-01 to SEC-08 checklist.
- The FIDO touch flow (US-1.3.2) joins the manual checklist, because no security key was available at ST-1.
- The four reviews of P-09, in parallel, over every commit after the tech stack commit
  (`docs(stack): add tech stack research and decisions`). Critical and high findings are fixed test-first and the
  reviews repeat until none remain. A fix that would go against the PRD or an owner decision waits for the owner.
- Final pass over CLAUDE.md, README, TECH_STACK and PRD status.
- Once the owner accepts the gate, the release workflow cuts `v0.2.0` with `bump: minor` (P-21); the owner set
  this version on 2026-11-13, after M1 shipped as `v0.1.0`.

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
| ST-21      | Decide any review finding whose fix would go against the PRD or an owner decision. Run the manual AT scripts (§11.3 for macOS), then confirm or reject the release gate.                                                  |

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
| ST-3  | Done        | —      |
| ST-4  | Done        | —      |
| ST-5  | Done        | —      |
| ST-6  | Done        | —      |
| ST-7  | Done        | —      |
| ST-8  | Done        | —      |
| ST-9  | Done        | —      |
| ST-10 | Done        | —      |
| ST-11 | Done        | —      |
| ST-12 | Done        | —      |
| ST-13 | Done        | —      |
| ST-14 | Done        | —      |
| ST-15 | Done        | —      |
| ST-16 | Done        | —      |
| ST-17 | Done        | —      |
| ST-18 | Done        | —      |
| ST-19 | Done        | —      |
| ST-20 | Done        | —      |
| ST-21 | Not started | —      |

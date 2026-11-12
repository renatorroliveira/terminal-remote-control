# Term Remote Control — Tech Stack

| Field        | Value                                                                    |
| ------------ | ------------------------------------------------------------------------ |
| Status       | Decisions accepted (v1.1). Spikes S1–S10 (§11) may revise details.       |
| Owner        | Renato Oliveira                                                          |
| Last updated | 2026-11-11                                                               |
| Requirements | [PRD.md](PRD.md). It sets the scope: nothing beyond it is built.         |

This document records the technology choices for P0 and why each one was made.
Versions were checked against the npm registry and crates.io on 2026-11-11.
The rule throughout: **one choice per need, and a fallback only where a spike
may force a switch.** Requirement IDs (`A11Y-*`, `SEC-*`, `NFR-*`, `US-*`,
`R*`, `OQ-*`) refer to the PRD.

`trcd` (the daemon binary) and `~/.trc/` (the per-user data directory) are
working names until the product is named (OQ-5).

---

## 1. Summary

| Layer               | Choice                                                                    | Main reason                                                              |
| ------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Languages           | TypeScript 7 (app), Rust (daemon), POSIX `sh` (bootstrap, SSH helpers)    | Each runs where it must, with the smallest footprint                     |
| Desktop runtime     | Electron 45 (Node 24, Chromium 156)                                       | Owner's baseline; Chromium accessibility on every desktop OS             |
| Terminal view       | xterm.js 6 with WebGL, plus our own Accessible Text Surface (ATS)         | Proven emulation; OS-visible text, selection and caret (A11Y-01..06)     |
| UI                  | React 19 + React Aria Components, Zustand, react-intl, CSS Modules        | Strongest accessible primitives; best support from AI assistants         |
| SSH                 | System OpenSSH client, one exec channel per host                          | Uses the user's config, agent and keys unchanged (US-1.1, SEC-03)        |
| App↔daemon protocol | Length-prefixed frames: JSON control (types from Rust via ts-rs), raw I/O | Simplest contract that still meets NFR-03 and NFR-12                     |
| Daemon              | Rust: tokio, portable-pty, libghostty-vt (fallback alacritty_terminal)    | Small static binary, low memory (NFR-09), memory safety                  |
| Persistence         | Per-session append-only files; no database; no encryption                 | Meets NFR-08 and SEC-05 with the least machinery                         |
| Build               | pnpm 12, electron-vite 6 (Vite 8), electron-builder 26, cargo-zigbuild    | Fast feedback, one tool per job                                          |
| Lint and format     | Biome 2.6 (lint, a11y, cognitive complexity ≤ 10), Prettier 3.10          | Owner's baseline; no ESLint needed                                       |
| Tests               | Vitest 5, Playwright 1.65 + axe-core, nextest, a macOS AX probe           | Covers DOM, OS accessibility tree, protocol and daemon                   |
| CI and releases     | GitHub Actions and GitHub Releases                                        | Hosted macOS, Linux and Windows runners                                  |
| Updates             | Signed manual downloads in E1–E2; Electron's built-in updater from E3     | Owner's decision; the built-in updater opens no listener (SEC-01)        |

## 2. Languages, and "does it need Rust IPC?"

Three product languages, each confined to one place:

- **TypeScript 7:** everything in the Electron app.
- **Rust:** the daemon `trcd`, the only code that runs on remote hosts.
- **POSIX `sh`:**
  - the bootstrap the app sends over SSH to detect the host, then upload and
    start the daemon (§7);
  - two small SSH helper scripts shipped inside the app (§7).

Two more appear only as tools. Zig is the cross-linker for cargo-zigbuild and
the build system of libghostty-vt; we write no Zig. Swift is used for one test
tool, the macOS accessibility probe (§9.6).

**Why Rust for the daemon.**

- The daemon is uploaded over SSH to hosts that have no runtime for it, and it
  must stay small: NFR-09 allows 30 MB RSS idle and 10 MB per session.
- A Rust research probe measured 0.6 MB stripped. It linked tokio, portable-pty,
  a VT emulator, JSON logging and SHA-256, and used 2.3 MB RSS as one process
  with one session.
- Each session runs in its own holder process (§5.4), so the expected cost is
  about that much per session. Spike S1 re-measures it with the real holder and
  libghostty-vt, using PSS.
- Node is ruled out. The runtime alone is 96–150 MB (Node SEA, Bun, Deno), and
  an idle Node 24 socket server uses about 45 MB RSS.
- Go was the runner-up. It loses because linking the C emulator needs cgo, and
  `os/exec` cannot attach a ConPTY (golang/go#62708), which E6 needs.
- Rust is memory safe while parsing untrusted terminal output (SEC-06). It also
  reaches the PTY, ConPTY and peer-credential APIs directly.

**There is no "Rust IPC" to build.** IPC here is a wire protocol (§6), not a
language feature.

- The Electron side needs only Node's `child_process` (to run `ssh`) and
  streams.
- No Rust runs inside Electron: no napi-rs addon and no node-pty.
- PTYs live in the daemon, so the app has no native modules at all. That
  removes Electron ABI rebuilds and the macOS `disable-library-validation`
  entitlement.

## 3. System architecture

```
Electron app (macOS in E1)                                    Host (Linux in E1)
┌──────────────────────────────────────────────┐            ┌───────────────────────────────┐
│ main process: windows, menus, dialogs,       │            │ trcd bridge  (per connection) │
│   clipboard, nativeTheme relay, updater (E3) │            │   stdio ⇄ core socket         │
│ connection host (utilityProcess):            │  ssh exec  │ trcd core    (one per user)   │
│   one `ssh` child per host, framing,         │ ─────────► │   registry, supervision,      │
│   credits, reconnect, bootstrap, host keys   │  channel   │   install/upgrade, restore    │
│ renderer (sandboxed): React UI, xterm.js,    │            │ trcd holder  (one per session)│
│   ATS, announcer                             │            │   PTY, shell, libghostty-vt,  │
│   ⇅ MessagePort to the connection host       │            │   query replies, scrollback   │
└──────────────────────────────────────────────┘            └───────────────────────────────┘
```

- **Main process.** Holds no session state, so a busy or restarted main process
  never affects sessions.
- **Connection host.** An Electron `utilityProcess`, following VS Code's
  pty-host pattern.
  - It owns every daemon connection, so SSH I/O and framing never compete with
    UI events.
  - It can restart without affecting windows, because sessions live in the
    daemons.
- **Renderer.** Receives output and events over a `MessagePort`, and sends
  input and credits back.
- **`trcd`.** One binary with three subcommands, `core`, `holder` and `bridge`
  (§5.4).
  - E1 ships only the Linux builds.
  - The macOS build arrives with local sessions in E5 (§7.4 of the PRD).
- **Local sessions (E5 onward).** Same path: the connection host spawns
  `trcd bridge` locally instead of through `ssh`.

## 4. Desktop app

### 4.1 Runtime

- **Electron 45.3** bundles Node 24.22 and Chromium 156. Electron 40 was the
  first major to ship Node 24.
- **Tooling runs on system Node 24 LTS**, so unit tests and the production main
  process use the same Node major.
- **Upgrades.** Electron 46 (planned for January 2027) moves to Node 26. When
  adopting it, move the tooling to Node 26 in the same change. Electron
  supports its latest three majors on an 8-week cadence; stay inside that
  window.
- **Typings.** `@types/node` is pinned to `~24` to match Electron's Node.

### 4.2 Processes, IPC and Electron security

- **Main ⇄ renderer.**
  - A small hand-written `contract.ts` maps each channel to its request and
    response types.
  - The preload exposes it through `contextBridge`.
  - `ipcMain.handle` validates every payload with zod.
- **Renderer ⇄ connection host.**
  - Main creates a `MessageChannelMain`. The preload forwards one port to the
    page with `window.postMessage`, Electron's pattern for context-isolated
    pages.
  - Output is batched for about 5 ms per session before posting, like VS
    Code's `TerminalDataBufferer`.
- **zod at the two trust boundaries.**
  - IPC from the sandboxed renderer.
  - Control messages from daemons. A compromised host controls its daemon, so
    these are untrusted like terminal output (SEC-06). Each schema is typed
    `z.ZodType<GeneratedType>`, which ties it to the type ts-rs generates.
- **Electron settings.**
  - `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
  - The UI is served from an `app://` scheme via `protocol.handle`, never
    `file://`.
  - CSP: `default-src 'none'; script-src 'self'; style-src 'self'
    'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src
    'none'`. `unsafe-inline` styles are needed because xterm.js injects style
    elements.
- **Fuses**, set with electron-builder's `electronFuses` before signing.
  - Off: `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`,
    `EnableNodeCliInspectArguments`, `GrantFileProtocolExtraPrivileges`.
  - On: `EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar`.
  - CI checks the release artifact with `npx @electron/fuses read`.
- **No debugging listener in releases.** Release builds never pass
  `--remote-debugging-port`; it is a Chromium switch, not a fuse. The SEC-01
  "no listening sockets" test runs against the signed release artifact, not
  the Playwright test build.
- **No login-shell environment read.**
  - macOS GUI apps already receive launchd's `SSH_AUTH_SOCK`.
  - ssh reads `IdentityAgent` from its own config.
  - `/usr/bin/ssh` is spawned by absolute path.
  - Revisit only if spike S4 finds agents that are reachable only from shell
    startup files.

### 4.3 Terminal view and accessibility

This is the number one requirement and the main technical risk (R1, R2).

**Engine and visuals.**

- One xterm.js 6 `Terminal` per session, rendered with `@xterm/addon-webgl`.
  The fallback is xterm's built-in DOM renderer.
- Addons:
  - `@xterm/addon-unicode-graphemes`, experimental, for grapheme clusters and
    widths (US-1.11);
  - `@xterm/addon-search` for find (US-1.13, A11Y-03.6);
  - `@xterm/addon-fit` for resizing.
- OSC 8 links go through `linkHandler`. OSC 52 uses `registerOscHandler` and is
  off by default (SEC-06).
- Terminal instances live in a `Map` outside React, so React never renders
  terminal DOM.
- **The daemon answers terminal queries.** The holder's emulator replies to DA,
  DSR/CPR, XTVERSION and OSC color queries, so programs never hang while no
  client is attached and never get duplicate replies.
  - The renderer swallows those queries with `registerCsiHandler` and
    `registerOscHandler` handlers that return `true`.
  - Title reporting and the other echo-back reports stay disabled in both
    emulators (SEC-06.3). xterm's `windowOptions` keep their all-off defaults.

**xterm.js's own screen reader mode stays off.**

- Its selection is a custom model that the OS cannot see.
- Its live region is assertive and stops after 20 rows.
- It reads content twice and uses list roles.

**Accessible Text Surface (ATS).** Our own layer, and the single focus target
of each terminal. It is modeled on Monaco's EditContext path.

- **Element.** A `div` with `role="textbox"` and `aria-multiline="true"`. Its
  name and description carry the session name, host and state (A11Y-01).
- **Placement.** Transparent text sits exactly over the WebGL canvas in the
  same cell metrics, so pointer reading (Speak items under the pointer) hits
  real text.
- **Content.**
  - One text node per row: the viewport plus overscan, **plus every row of the
    current selection, up to the selection cap**.
  - Chromium exposes `AXSelectedText` and `AXSelectedTextRange` only for text
    fields, and `AXSelectedTextMarkerRange` everywhere. The ATS must own the
    DOM selection.
  - Spike S2 confirms this mapping attribute by attribute.
- **Input** (A11Y-09).
  - `EditContext` receives keys, IME and dictation. EditContext cannot attach
    to a `<textarea>`, so the ATS is a `div`.
  - A small key encoder, ported from xterm's MIT `Keyboard.ts`, reads
    `term.modes` and sends the bytes.
- **Selection** (A11Y-04).
  - Selection changes in xterm (`onSelectionChange`) are mirrored into the DOM
    with `setBaseAndExtent`.
  - DOM selection changes made by assistive technology or the keyboard flow
    back through `term.select()`.
  - Look Up and Services work from the DOM selection:
    `webContents.showDefinitionForSelection()` and the `services` menu role.
  - Size cap (D-08):
    - The OS sees at most about 5,000 selected lines; spike S3 tunes the
      number.
    - Copy always copies the full selection, and the cap is announced
      (A11Y-04.7).
- **Caret** (A11Y-06).
  - With no selection, a collapsed DOM caret sits at the terminal cursor. That
    drives `AXSelectedTextRange` and magnifier focus tracking.
  - `EditContext.updateSelectionBounds()` and `updateControlBounds()` place
    the IME and dictation UI.
- **Announcer** (A11Y-02, A11Y-12).
  - Assembles logical lines and suppresses shell echo of typed characters (R9).
  - Collapses floods into a summary ("312 lines of output") and can be muted.
  - Speaks through `Element.ariaNotify()`, available since Chromium 141. If
    VoiceOver drops notifications, the fallback is one persistent polite live
    region.
  - The UI's status messages go through the same announcer.
- **Review mode** (A11Y-03, D-07).
  - The same ATS in read-only mode, holding a page of about 500 logical lines
    around the review caret. It re-pages when the caret crosses an edge, like
    VS Code's Accessible View.
  - The page grows to cover a selection, up to the same cap.
  - Screen readers navigate it with caret commands in focus mode. NVDA switches
    to focus mode on its own for read-only editable text.
  - The page is bounded because a prototype that put the whole buffer into one
    `contenteditable` froze NVDA for 15–60 s (xterm.js #4340).
- **Update cadence** (R2). Chromium re-serializes every changed accessibility
  node.
  - Without AT, the ATS updates once per animation frame.
  - With AT running, it updates at most about 4 times a second and holds still
    while a flood lasts.
- **Always on.** The ATS and the DOM selection stay active without a screen
  reader, so Speak Selection and Look Up always work. Announcements depend on
  Chromium reporting AT, or on the manual screen-reader setting (A11Y-10).
- **Minimum contrast** (A11Y-07).
  - xterm.js `minimumContrastRatio` is set to 4.5.
  - xterm halves that floor for dim (SGR 2) text, and A11Y-07 needs the full
    floor. The E1 terminal work fixes dim rendering whenever contrast is
    enforced.

**Fallback engine.** libghostty-vt's WASM build (under 1 MB) sits behind a
`TerminalModel` interface. It replaces xterm.js's parser only if
xterm.js fails grapheme fidelity in spike S1 (US-1.11). The ATS is unchanged
either way.

### 4.4 UI

- **React 19.3**, built with `@vitejs/plugin-react`, without the React
  Compiler, which is experimental and needs an extra native transform package.
  - Svelte and Vue lose because TypeScript 7.0 has no programmatic API, which
    their type checkers (svelte-check, vue-tsc) need.
  - Lit loses because shadow DOM breaks ARIA ID references.
  - Vanilla TypeScript would mean writing every ARIA pattern by hand.
- **React Aria Components 1.22** (Adobe, Apache-2.0) supplies:
  - Dialog and Modal;
  - Menu, including context menus;
  - Autocomplete with ListBox for the command palette and quick switcher
    (US-4.4);
  - Tooltip, form fields, SearchField, Switch, NumberField;
  - I18nProvider.
- **Built in-house**, because each needs exact semantics:
  - **Session tree** with `role="tree"` on `div` elements. RAC Tree renders a
    `treegrid`, which VoiceOver presents as a table.
    - Every row sets `aria-level`, `aria-posinset`, `aria-setsize` and
      `aria-expanded`.
    - Row actions go through the context menu and the palette (A11Y-11).
  - **Splitter** following the APG window splitter pattern.
  - **Announcer**, shared with the terminal.
  - **Persistent notification list** in the status bar. Nothing dismisses
    itself (A11Y-11).
  - RAC Toast is not used. It is still `UNSTABLE_`, and its landmark handler
    captures F6, which conflicts with A11Y-05 and with htop and mc.
  - No list virtualization in P0. Measure with VoiceOver against NFR-05 first.
- **State.**
  - The renderer holds one vanilla Zustand 5 store: a read model of hosts and
    sessions, normalized by ID and fed by snapshot-plus-patch events.
  - In the connection host, each host's connection lifecycle is a
    discriminated-union reducer with an exhaustive switch, covered by unit
    tests.
- **i18n** (NFR-13). react-intl 12 with ICU messages, precompiled with
  `@formatjs/cli`. `<html lang>` and RAC's `I18nProvider` follow the active
  locale.
- **Styling and themes** (A11Y-07, A11Y-08).
  - CSS Modules, which Vite supports natively. Design tokens are CSS custom
    properties in `@layer`s. No Tailwind and no CSS-in-JS.
  - The main process relays these OS display settings to the renderer as
    `data-*` attributes on `<html>`, using `nativeTheme` and
    `systemPreferences`:
    - dark mode;
    - high contrast and Increase Contrast;
    - forced colors (Windows);
    - inverted colors;
    - reduced transparency;
    - differentiate without color;
    - reduced motion.
  - Media queries are a secondary signal only. Electron may not drive
    `prefers-contrast` on macOS; verify in E1.
  - Forced colors (E6) use system colors and outline focus rings.
  - A dev-only colorjs.io test checks every token pair in every theme, plus the
    focus, selection and cursor colors (PRD §11.2).

### 4.5 Packaging, signing and updates

- **electron-vite 6** builds main, preload, the utility process and the
  renderer with Vite 8, with hot module replacement in the renderer.
  - The dev server binds to `127.0.0.1` and exists only in development.
  - Packaged builds load from `app://` and open no listener (SEC-01).
- **electron-builder 26** packages, signs and notarizes.
  - **macOS (E1).**
    - Developer ID signature with the hardened runtime, notarized with an App
      Store Connect API key. Until a Developer ID identity exists, E1 builds
      are ad-hoc signed and not notarized (D-17).
    - The only entitlement is `com.apple.security.cs.allow-jit`.
    - Outputs a dmg for installs and a zip as the update payload.
  - **Windows (E6).** A per-user install with no administrator rights
    (SEC-07), signed through Azure Artifact Signing. The installer format is
    chosen together with the Windows updater.
  - **Linux (E7).** A user-level install with no root (SEC-07.1), so an
    AppImage. deb and rpm packages need root to install. Signing and the update
    path are settled in E7.
- **Daemon binaries.**
  - They ship under `Contents/Resources/daemon/<os>-<arch>/` via
    `extraResources`, with a SHA-256 manifest inside the signed bundle
    (SEC-04).
  - Linux ELF files are sealed as resources by the bundle signature.
  - The macOS daemon (E5) is listed in `mac.binaries`, so it gets a Developer
    ID signature and the hardened runtime.
- **SSH helpers.** `askpass` and `known-hosts` are POSIX `sh` scripts in
  `Contents/Resources/bin/` (§7). On Windows (E6) they become `trcd`
  subcommands, because the Windows daemon ships in that epic.
- **Updates (D-06).**
  - **E1–E2.** Users download signed, notarized builds from GitHub Releases.
  - **E3 (US-3.4).**
    - Electron's built-in `autoUpdater` (Squirrel.Mac) reads a static JSON feed
      (`serverType: 'json'`) published as a GitHub Release asset. Each entry
      carries the zip's `sha256` and `size`.
    - Squirrel.Mac checks that the update's code signature matches the running
      app before installing.
    - The update installs on restart.
    - The feed must be publicly downloadable; otherwise host the same files on
      any static HTTPS host.
  - **Why not electron-updater.** On macOS it serves the downloaded update to
    Squirrel.Mac through a local HTTP server on `127.0.0.1`, which SEC-01
    forbids.
  - **E6 and E7.** The Windows and Linux updaters are chosen in those epics,
    under the same SEC-01 and SEC-07 constraints. US-6.1 and US-7.1 carry
    US-3.4 to those platforms.
- **No telemetry, no crash reporting (D-09).** `crashReporter` is never
  started, because minidumps can hold terminal text (SEC-08).

## 5. Daemon (`trcd`, Rust)

### 5.1 Toolchain

- Rust stable 1.99, pinned in `rust-toolchain.toml`, edition 2024.
- **Linux:** static musl binaries for `x86_64` and `aarch64`, built with
  **cargo-zigbuild 0.24** and Zig 0.17. One binary per architecture runs on
  both glibc and musl hosts (PRD §7.2).
- **macOS (E5):** a universal2 binary built on a macOS runner.
- **Windows (E6):** an MSVC build.
- Not used: `cross` (unmaintained) and cargo-dist (not needed).

### 5.2 Crates

| Need                                             | Crate (version, license)                                        | Fallback (spike that decides)      |
| ------------------------------------------------ | --------------------------------------------------------------- | ---------------------------------- |
| Async runtime, sockets, named pipes, processes   | tokio 1.54 (MIT); tokio-util 0.7 (MIT) for framing              | —                                  |
| PTY and ConPTY                                   | portable-pty 0.9 (MIT)                                          | pty-process 0.5 (S1, S9)           |
| VT emulator, snapshots, persistence format       | libghostty-vt 1.0.1 (MIT) through our own thin FFI crate        | alacritty_terminal 0.26 (S1, S9)   |
| Unix calls (setsid, modes, flock, fdatasync)     | rustix 1.1 (Apache-2.0/MIT)                                     | —                                  |
| Windows calls (pipe client PID, SIDs, ACLs, jobs)| windows-sys 0.61 (MIT/Apache-2.0)                               | —                                  |
| Control messages and metadata                    | serde 1.0 + serde_json 1.0 (MIT/Apache-2.0)                     | —                                  |
| TypeScript types generated from Rust             | ts-rs 12 (MIT)                                                  | —                                  |
| Checksums                                        | sha2 0.11 (binaries), crc32fast 1.5 (log records)               | —                                  |
| Logging                                          | tracing 0.1, tracing-subscriber 0.3 (JSON), tracing-appender 0.2 | —                                 |
| Errors                                           | thiserror 2                                                     | —                                  |

Not used:

- a CLI parsing framework (the subcommands are fixed);
- TOML, SQLite, compression;
- the `interprocess` crate;
- the community `libghostty-vt` crate, which pins a pre-1.0 commit and
  downloads source at build time.

### 5.3 Terminal state (D-02)

**Why the daemon needs an emulator.** The daemon keeps the authoritative
screen and scrollback. It uses them for reattach, shared sessions, resync after
a flood, restore after a reboot and terminal query replies.

**libghostty-vt 1.0.1.** Its C ABI has been stable since 2026-11-06, and
Ghostty is its reference implementation.

- It handles grapheme clusters, reflow, OSC 8 and the alternate screen.
- Its formatter re-emits the state as VT for replay into xterm.js.
- Cells take 8 bytes. That is about 10 MB per 10,000 lines of 120 columns,
  which supports NFR-10.
- Our FFI crate's bindings are generated once with bindgen 0.73 and checked in.
- On Linux and macOS it links statically. On Windows it links the way the 1.0
  release documents: x86_64 is tested in its CI through an MSVC import library.

**Fallback.** Everything sits behind a `TerminalState` trait, so the engine can
be swapped in one place.

- If libghostty-vt proves incompatible with a target OS, switch to
  alacritty_terminal.
- The cost: grapheme-cluster fidelity, a VT serializer we write ourselves, and
  about 32 MB per 10,000 lines.

**When to decide.** Spike S1 (E1) for Linux and macOS, and S9 (E6) for
Windows. A switch can happen in a later epic.

### 5.4 Processes, kill scope and upgrades (R4–R7)

**`trcd core`.** Registered with the service manager. It handles the protocol,
the session registry, holder supervision, install, upgrade and restore.

- Its state can always be rebuilt: on start it re-adopts every live holder from
  `run/holders/*.sock`.

**`trcd holder`.** One per session. It owns the PTY or ConPTY, the shell, the
emulator (including query replies) and the persistence writer.

- It keeps reading output while the core is down (US-2.1, US-2.5).
- It never blocks on a slow client.

**`trcd bridge`.** Relays stdio to the core's socket, and starts the core if it
is not running, like `wezterm cli proxy`.

**Integrity at start (SEC-04.4).** Every subcommand refuses to start if its
binary, its version directory or the install root is owned by another user or
writable by group or others.

**Linux service mode (US-2.4).**

1. If `loginctl show-user` reports `Linger=yes`, install `trcd.service` as a
   systemd user unit.
2. Otherwise, try `loginctl enable-linger --no-ask-password`. Polkit usually
   refuses it over SSH. If it succeeds, use the unit.
3. Otherwise, the core and holders double-fork and call `setsid`.
4. If `KillUserProcesses=yes` and lingering is unavailable, the app warns that
   sessions cannot outlive the last connection (US-2.4.4).

**Staying out of the kill scope.**

- **Linux unit.** The core keeps the default `KillMode=control-group`. Each
  holder starts through `systemd-run --user --scope --collect` before its
  shell, which takes it out of the unit's control group. tmux does the same.
- **macOS (E5).**
  - Holders call `setsid()`, and the LaunchAgent sets `AbandonProcessGroup`.
  - Registration uses Electron's
    `app.setLoginItemSettings({ type: 'agentService' })` (SMAppService).
  - Remote Macs without a GUI login get a detached core (R7).
- **Windows (E6).**
  - Each holder owns its pseudoconsole and starts with
    `CREATE_BREAKAWAY_FROM_JOB | DETACHED_PROCESS`.
  - Microsoft's redistributable `conpty.dll` (MIT) ships next to the binary.

**Upgrade without session loss (US-2.5).**

1. Upload the new binary, verify it and rename it into `versions/<sha256>/`.
2. Swap the `current` symlink atomically.
3. Restart the core, which speaks holder protocol versions N and N−1.

Holders are never upgraded in place. An old session keeps its old holder until
it ends, and unused versions are deleted after that. VS Code Server uses the
same side-by-side layout.

We don't need `SCM_RIGHTS` handoff or the systemd fd store. The fd store keeps
descriptors alive, but shells inside the unit's control group still die.

### 5.5 Persistence (E3; SEC-05, NFR-08)

One directory per session (mode 0700, files 0600):

- **`meta.json`** holds the shell profile snapshot, args, environment, working
  directory, size, name and order. Each write goes to a temporary file, is
  fsynced, then renamed into place.
- **`history.log`** holds append-only `[len][crc32][VT-formatted rows]` records
  for rows that have left the screen.
  - `fdatasync` runs every 2 s while there are new records, so on-disk lag
    stays well inside NFR-08's 5 s.
  - Recovery truncates the log at the first bad CRC.
  - Compaction runs when the log grows past twice the scrollback limit.
- **`screen.vt`** holds the current screen. It is rewritten (temp file, fsync,
  rename) at most every 2 s while the screen changes.

Rules:

- Sessions marked "Do not save scrollback to disk" (US-3.2) write neither
  `history.log` nor `screen.vt`.
- Closing a session deletes its directory.
- Restore feeds the history into a new holder's emulator, adds the marker line,
  then starts the shell. Commands are never re-run.

There is no app-level encryption, because SEC-05's user-only permissions are
the control (D-05, which resolves OQ-1). There is no SQLite either: it needs a
C build, and nothing is queried.

### 5.6 Local IPC and peer authentication (SEC-01, SEC-02)

**Socket.** `~/.trc/run/core.sock`, mode 0600 inside a 0700 directory.

- If the path is too long for a Unix socket (104 bytes on macOS, 108 on
  Linux), fall back to `/tmp/trc-<uid>/`.
- Not `$XDG_RUNTIME_DIR`: systemd deletes it when the user's last session ends,
  which would remove a detached daemon's socket.

**Unix.** The core accepts only peers whose `UnixStream::peer_cred()` uid
matches its own. Clients `lstat` the directory and check its owner and mode.

**Windows (E6).**

- The pipe is created with `first_pipe_instance(true)` and an ACL that grants
  only the user's SID. Remote clients are rejected by default.
- The server checks `GetNamedPipeClientProcessId` and that process's token
  user SID.
- The bridge, as the client, checks `GetNamedPipeServerProcessId` the same way.

**No TCP or UDP socket exists anywhere.** CI asserts this on a running daemon
and on the signed app.

### 5.7 Logging (SEC-08)

- `tracing` writes JSON through `tracing-appender`: daily rotation, a cap on
  the number of files, mode 0600.
- PTY bytes, keystrokes, environment values and clipboard data are wrapped in a
  `Sensitive<T>` type that prints `[redacted]`.
- Soak tests print canary strings and fail if any log contains one.
- Hosts get no config file; the app sends settings to the daemon.

## 6. App↔daemon protocol (D-03, D-04)

### Framing

One byte stream per daemon connection, made of frames:
`u32 length (big-endian) | u8 kind | u32 stream | payload`.

| Kind      | Payload                                       |
| --------- | --------------------------------------------- |
| `CONTROL` | One JSON message (stream 0)                   |
| `OUTPUT`  | Raw PTY bytes, at most 32 KiB per frame       |
| `INPUT`   | Raw input bytes                               |
| `CREDIT`  | `u32` bytes granted to the sender             |

The connection host routes output after reading the 9-byte header, without
parsing JSON.

### Control messages

Control messages are tagged unions defined once as Rust `serde` types. ts-rs
exports the TypeScript types, which are checked in, so building the app never
needs Rust. Every request carries a `requestId`.

1. **Handshake.** `Hello { minProto, maxProto, appVersion, caps }`, answered by
   `Welcome { proto, daemonVersion, binarySha256, caps }` or
   `Incompatible { range }`.
2. **Liveness.** `Ping` and `Pong`.
3. **Catalog.** `ListSessions` and `ListProfiles`. The daemon pushes
   `SessionEvent` (created, updated, closed, state) to every client (US-2.6).
4. **Lifecycle.** `Create`, `Rename`, `Reorder`, `Stop`, `Restart`.
5. **Attach.**
   - `Attach { session, fromOffset, mode: full | events }`, answered by
     `Attached { stream, offset, snapshot? }`.
   - `Detach` and `Resize`.
   - `ReadRows { session, fromRow, count }`, which returns scrollback rows the
     client lacks.
   - Reconnecting is an `Attach` with `fromOffset` (US-2.2).
6. **Semantic events.** The daemon parses OSC 133, OSC 7, OSC 0/2 and BEL into
   `CommandFinished`, `Cwd`, `Title`, `Bell` and `Activity`.
   - Background sessions attach in `events` mode, so no output flows for them.
   - That keeps 25 hosts × 100 sessions cheap (NFR-05) while US-4.3 still
     works.
7. **Errors.** `Error { requestId, code, message }`.

### Flow control (D-04: skip to latest)

- **Credit.** Each attached stream gets a 256 KiB window. The renderer returns
  credit from xterm.js write callbacks in 64 KiB steps, as VS Code and the
  xterm.js flow-control guide do.
- **No blocking.** The holder never stops reading the PTY. Programs never
  block, and one slow client never slows the others (US-2.6).
- **Resync.** A client that runs out of credit gets nothing more until it
  catches up. It then receives `Resync` with the current screen instead of the
  backlog, as mosh does.
- **Gaps.** Scrollback skipped this way is backfilled with `ReadRows` once
  output pauses. Opening review mode or find first fetches any gap, so both
  see every line even during a sustained flood (A11Y-02.3, A11Y-03).
- **Input first.** `INPUT` and `CONTROL` frames never queue behind `OUTPUT`, so
  Ctrl+C reaches the program within NFR-03.

### Versioning (NFR-12)

- App and daemon each implement protocol versions N and N−1, and the handshake
  picks the highest version both support.
- Schema rules:
  - new fields are added and optional;
  - unknown fields are ignored;
  - enums have an `unspecified` default;
  - optional features are capability strings.
- **Fixtures.** A shared corpus (`protocol/fixtures/v<N>/`) is checked by both
  sides: insta snapshots in Rust, Vitest in TypeScript. N−1 fixtures stay until
  N+1 ships.

**E1 (D-19).** E1 attaches one client per session, so it uses backpressure
instead of skip-to-latest: when the client's credit runs out, the holder stops
reading the PTY until credit returns, and programs block as in any terminal.
`INPUT` and `CONTROL` still never queue behind `OUTPUT`. `Resync`, `ReadRows`
and "never block" arrive in E2 with multiple clients.

### Not used

- Protobuf and buf: more tooling, and prost is passively maintained.
- ConnectRPC and gRPC: they hide the per-stream credit logic.
- Cap'n Proto and FlatBuffers.
- JSON-RPC with base64-encoded output.

## 7. SSH transport and remote bootstrap

**One `ssh` process and one exec channel per host carry every session**, with
our multiplexer (§6) inside.

- sshd allows 10 channels per connection by default (`MaxSessions`).
- Extra connections would mean extra FIDO touches.
- Exec-only works even when forwarding is disabled (US-1.5).

```
ssh -T -e none -o BatchMode=yes -o StrictHostKeyChecking=yes
    -o "KnownHostsCommand='<app>/Contents/Resources/bin/known-hosts' %I %H %t %K %f"
    -o PreferredAuthentications=publickey -o PasswordAuthentication=no
    -o KbdInteractiveAuthentication=no -o ForwardAgent=no -o ForwardX11=no
    -o ClearAllForwardings=yes -o PermitLocalCommand=no
    -o ServerAliveInterval=10 -o ServerAliveCountMax=2 -o ConnectTimeout=15
    -o LogLevel=ERROR <host-alias> 'exec /bin/sh -s'
env: SSH_ASKPASS=<app>/Contents/Resources/bin/askpass  SSH_ASKPASS_REQUIRE=force
```

**Precedence.** ssh keeps the first value it obtains for each option, so
command-line `-o` values win over the user's config (US-1.1.4, SEC-03).

**What the app overrides, and why.**

- **Security settings.** BatchMode, host-key checking and the authentication
  methods are always overridden, so a weak user config can never weaken the
  app's connections (SEC-03).
- **Forwarding.** `ClearAllForwardings` and `ForwardX11=no` stop the user's
  configured forwards from opening listening sockets on the client or the host
  (SEC-01).
- **Agent forwarding.** `ForwardAgent=no` is stricter than SEC-03 requires.
  Sessions never inherit the connection's environment, so a forwarded agent
  could never reach them anyway.

**What the app honors.** Everything else in the user's config: aliases, users,
ports, keys, certificates, `IdentityAgent`, `ProxyJump`, `ProxyCommand` and
`known_hosts` (US-1.1.2).

- `ControlMaster` and `ControlPath` are left to the user's config. A configured
  master is used, but the app never requires one, which keeps Windows working.

**Host keys (US-1.2).**

- OpenSSH 8.5+ runs the `KnownHostsCommand` helper with the key presented on
  this connection, including through ProxyJump.
- ssh splits the command line itself without a shell, so the helper path is
  quoted for the spaces in the app name.
- The helper prints `%H %t %K` on stderr behind a per-connection nonce and
  returns no keys. It ignores the `%I=ORDER` call, whose key arguments are the
  literal `NONE`.
- BatchMode then refuses the unknown key, and the app shows its accessible
  dialog.
- Accepting appends the key to `known_hosts` (hashed if `ssh -G` reports
  `hashknownhosts yes`) and reconnects.
- A changed key is refused, with no override.
- `ssh-keyscan` is not used, because it ignores ProxyJump.

**FIDO keys (US-1.3).**

- In BatchMode, OpenSSH still sends its "Confirm user presence" notice to
  `SSH_ASKPASS`, with `SSH_ASKPASS_PROMPT=none`.
- The `askpass` helper relays that notice on stderr, and the app shows it as
  "Touch your security key for <host>".
- The helper refuses every other prompt by exiting non-zero without output.

**Diagnostics (US-1.3).**

- `ssh-add -l` tells "no agent" apart from "agent has no identities".
- Other failures are classified from stderr. Spike S4 builds that message
  corpus.

**Configuration.**

- `ssh -G <alias>` gives the effective settings.
- The host picker walks `~/.ssh/config` and its `Include`s itself, about 60
  lines of code, because ssh has no listing command.
- `ssh -V` must report 8.5 or newer. On Windows (E6), Windows OpenSSH is
  spawned by absolute path.

**Liveness (NFR-07).** ServerAlive at 10 s × 2, plus an application `Ping`
every 5 s with a 15 s timeout, detect a dead connection within 30 s.

**Startup-file noise.** Remote startup files can print to stdout. The bootstrap
prints a random nonce marker, and the app discards everything before it.

**Not used.** ssh2 (JavaScript) and russh (Rust). Neither reads `ssh_config`,
so either would mean reimplementing the user's SSH setup (US-1.1).

### Bootstrap (US-1.4)

A POSIX `sh` script is piped to `/bin/sh -s` on the host.

1. **Hello.**
   - `umask 077`, then print `<nonce> HELLO`.
   - Report the OS (`uname -s`), the architecture (`uname -m`, mapped to x86_64
     or arm64), the installed versions and the available checksum tool.
   - An unsupported system gets an error that names what is missing, and
     nothing is left behind.
2. **Command.** Read one command: `UPLOAD <size> <sha256> <version>` or
   `RUN <version>`.
3. **Upload.**
   1. Take an atomic `mkdir` lock, breaking it if stale.
   2. Read exactly the stated number of bytes (`head -c`, falling back to `dd`)
      into a temporary file.
   3. Verify the checksum with `sha256sum`, `shasum -a 256` or
      `openssl dgst -sha256`.
   4. `chmod 700`, then rename into `versions/<sha256>/`.
   5. Run `--version`. Exit code 126 means a noexec mount, so point the user to
      the per-host install location setting (R10).

   A trap removes everything on any failure.
4. **Run.** `exec "$bin" bridge`. `Hello` and `Welcome` follow on the same
   channel.

## 8. Shell selection (US-1.7, US-4.1, US-6.2, US-6.3)

Users pick a **shell profile** for each session, and the default is the host's
login shell. The daemon detects and stores profiles **per host**, and every
session keeps a resolved copy so E3 can respawn exactly the same shell.

```ts
type ShellKind = 'bash' | 'zsh' | 'fish' | 'pwsh' | 'powershell' | 'cmd' | 'wsl' | 'sh' | 'other';

interface ShellProfile {
    readonly id: string; // 'login', 'detected:zsh' or a UUID
    readonly name: string;
    readonly origin: 'login' | 'detected' | 'user';
    readonly kind: ShellKind; // selects shell integration
    readonly path: string; // absolute path on that host
    readonly args: readonly string[];
    readonly login: boolean; // POSIX argv[0] "-zsh"; pwsh -Login
    readonly env: Readonly<Record<string, string | null>>; // null unsets
    readonly cwd?: string;
    readonly integration: 'auto' | 'off';
    readonly wslDistro?: string;
}
```

The Rust struct is the source of this type; ts-rs exports it.

**Login shell on Linux and macOS.**

1. `$SHELL`, which sshd or launchd sets from the user's account.
2. The account's passwd entry. On macOS that is `getpwuid_r`, which covers
   Directory Services. On Linux it is `getent passwd $(id -u)`, because a
   static musl binary cannot see NSS users such as LDAP.
3. `/bin/sh`.

**Other shells.** Entries in `/etc/shells` that exist on disk, plus a PATH
probe for bash, zsh, fish and pwsh. The login shell starts as a login shell
(`arg0("-zsh")`).

**Windows (E6).**

- pwsh: `%ProgramFiles%\PowerShell\7\pwsh.exe`, then PATH.
- Windows PowerShell: `System32\WindowsPowerShell\v1.0\powershell.exe`.
- cmd: `%ComSpec%`.
- WSL distributions: read from `HKCU\…\Lxss` and started with `wsl.exe -d`
  by absolute path, as Windows Terminal does.
- Anything else, such as Git Bash, is a user profile. The app warns when a
  shell path is writable by other users.

**Environment.**

- The daemon sets `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM`
  and `TERM_PROGRAM_VERSION`.
- Sessions never inherit the daemon's environment. It carries stale `SSH_*`
  values from whichever connection started it.

**Shell integration (US-4.1).** Our own short scripts emit OSC 133 A/B/C/D and
OSC 7. They are embedded in the daemon, written to its 0700 directory and
injected without editing dotfiles.

- **bash:** `--init-file`, with a script that sources the user's normal
  startup files first.
- **zsh:** `ZDOTDIR` points at wrapper files that source the user's originals.
- **fish:** fish 4 emits OSC 133 and OSC 7 natively, so nothing is injected.
  Older fish gets `--init-command`.
- **pwsh:** `-NoExit -Command ". '<script>'"`.

Injection can be turned off per profile or per host. VS Code's scripts are not
reused, because they emit only OSC 633 and print environment values.

**Marks never trigger actions (SEC-06).** They drive navigation and
announcements only. Whether to also read OSC 633 stays open (OQ-6).

## 9. Tooling

### 9.1 Workspace

- **pnpm 12 workspaces (D-10).** Settings live in `pnpm-workspace.yaml`,
  including `minimumReleaseAge` for supply-chain safety.
- **Cargo workspace** for the Rust side.
- **Root `package.json` scripts** (`check`, `lint`, `format`, `test`,
  `test:e2e`, `build`) call pnpm and cargo. No Turborepo or Nx.

Layout:

```
apps/desktop/             Electron app (@trc/desktop)
  src/main/               main process
  src/preload/
  src/connection-host/    utilityProcess: ssh, framing, reconnect, bootstrap
  src/renderer/           React UI, terminal view, ATS, announcer
  src/shared/             IPC contract, ids, pure helpers
  resources/bin/          askpass and known-hosts sh helpers, bootstrap.sh
  resources/daemon/       bundled trcd binaries and manifest (generated)
  resources/docs/         user documentation (HTML)
  test/e2e/               Playwright _electron specs
packages/protocol/        framing, generated types, zod schemas (@trc/protocol)
crates/trcd/              daemon: core, holder, bridge
crates/trc-protocol/      protocol types (serde + ts-rs export), frame codec
crates/ghostty-vt-sys/    FFI bindings to libghostty-vt
crates/trc-vt/            safe wrapper and the TerminalState trait
protocol/fixtures/        versioned protocol fixtures shared by both sides
tools/ax-probe/           Swift AXUIElement probe used by tests
tools/test-hosts/         sshd containers for integration and e2e tests (D-15)
tools/fetch-libghostty.sh verified libghostty-vt source fetch (D-14)
docs/plans/               one implementation plan per epic
```

### 9.1.1 Development tools

- **minisign** verifies the libghostty-vt release signature (D-14).
- **colima** runs the Linux test hosts in its own `trc` profile, and the
  **docker CLI** drives them (D-15). Both are development-only.

### 9.2 TypeScript 7

- **TypeScript 7.0.2 is the stable native compiler.** 7.0 has no programmatic
  API; 7.1, now in beta, adds one. Nothing in this stack needs that API, so no
  TypeScript 6 is installed.
- **Type-check only.** Vite transpiles with Oxc, and `tsc` runs with `noEmit`.
- **One tsconfig per process** (main, preload, connection host, renderer). Each
  has its own `lib` and `types`, and they are checked in parallel. TypeScript 7
  defaults `types` to `[]`, so the Node configs list `"node"`.
- **Editor.** VS Code needs the TypeScript 7 native language-service extension
  named in the 7.0 announcement.

`tsconfig.base.json` compiler options, validated with `tsc` 7.0.2:

```json
{
    "compilerOptions": {
        "target": "es2025",
        "module": "preserve",
        "moduleResolution": "bundler",
        "noEmit": true,
        "strict": true,
        "exactOptionalPropertyTypes": true,
        "noUncheckedIndexedAccess": true,
        "noImplicitOverride": true,
        "noImplicitReturns": true,
        "noFallthroughCasesInSwitch": true,
        "noPropertyAccessFromIndexSignature": true,
        "verbatimModuleSyntax": true,
        "erasableSyntaxOnly": true,
        "isolatedModules": true,
        "noUncheckedSideEffectImports": true,
        "skipLibCheck": true
    }
}
```

### 9.3 Biome (lint only) and accessibility linting

**Biome 2.6** lints TypeScript, TSX and HTML.

- **Accessibility rules.** The `a11y` group has 38 rules and covers most of
  eslint-plugin-jsx-a11y. The notable gap is `control-has-associated-label`,
  which the axe tests cover.
- **Complexity.** `noExcessiveCognitiveComplexity` is off by default and its
  default limit is 15, so the config turns it on with a limit of 10.
- **Formatting.** Biome's formatter is off; Biome only sorts imports.
- **Deliberate exceptions** are suppressed line by line with
  `biome-ignore <rule>: <reason>`, never with file-wide overrides. The known
  one: the ATS `div role="textbox"` trips `useSemanticElements`, and it must
  be a `div` because EditContext cannot attach to a `<textarea>`.
- **Prerequisite.** `vcs.useIgnoreFile` needs a `.gitignore` to exist.

**Why no ESLint.**

- typescript-eslint requires `typescript` below 6.1, so it would need a
  TypeScript 6 compatibility alias.
- eslint-plugin-jsx-a11y doesn't support ESLint 10, and ESLint 9 is end of
  life.
- Static rules only see markup anyway. The real accessibility gate is the
  runtime tests (§9.6).

`biome.json`, validated with Biome 2.6.7:

```json
{
    "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
    "root": true,
    "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true, "defaultBranch": "main" },
    "files": { "includes": ["**", "!**/dist", "!**/out", "!**/target", "!**/.vitest"] },
    "formatter": { "enabled": false },
    "assist": { "enabled": true, "actions": { "source": { "organizeImports": "on" } } },
    "html": { "experimentalFullSupportEnabled": true },
    "linter": {
        "enabled": true,
        "domains": { "project": "recommended", "types": "recommended" },
        "rules": {
            "preset": "recommended",
            "a11y": "error",
            "complexity": {
                "noExcessiveCognitiveComplexity": { "level": "error", "options": { "maxAllowedComplexity": 10 } },
                "noExcessiveLinesPerFunction": { "level": "warn", "options": { "maxLines": 50, "skipBlankLines": true } },
                "noExcessiveNestedCallbacks": { "level": "error", "options": { "max": 3 } },
                "useMaxParams": "error"
            },
            "suspicious": { "noConsole": { "level": "error", "options": { "allow": ["error", "warn"] } } }
        }
    }
}
```

### 9.4 Prettier and EditorConfig

- **Prettier 3.10**, pinned to an exact version.
- **`jsxSingleQuote: false`.** JSX attributes keep HTML-style double quotes,
  and every JavaScript string uses single quotes.
- **`trailingComma: "all"`** keeps diffs small.
- **Markdown hard breaks** use a trailing backslash, because whitespace
  trimming removes two-space breaks.
- **Existing docs.** When these configs land, the existing docs are formatted
  once in a dedicated `style:` commit, which re-indents about 400 lines of the
  PRD.

`.prettierrc.json`:

```json
{
    "$schema": "https://json.schemastore.org/prettierrc",
    "printWidth": 120,
    "tabWidth": 4,
    "useTabs": false,
    "endOfLine": "lf",
    "singleQuote": true,
    "jsxSingleQuote": false,
    "arrowParens": "always",
    "trailingComma": "all"
}
```

`.editorconfig`, which adds the final newline and whitespace trimming for every
file, including those Prettier doesn't format:

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 4
max_line_length = 120
```

### 9.5 Rust lint and format

- `rustfmt.toml`: `edition = "2024"`, `max_width = 120`, `tab_spaces = 4`,
  `hard_tabs = false`, `newline_style = "Unix"`.
- `clippy.toml`: `cognitive-complexity-threshold = 10`.
- `Cargo.toml`, under `[workspace.lints.clippy]`:
  `all = { level = "deny", priority = -1 }` and `cognitive_complexity = "deny"`.
  A justified exception uses
  `#[expect(clippy::cognitive_complexity, reason = "…")]`.

### 9.6 Testing

| Level                     | Tool                                                                                           | Covers                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| TypeScript unit           | Vitest 5 projects for main, connection host and shared code                                    | Reducers, framing, ssh arguments, parsers                                        |
| Renderer components       | Vitest browser mode (`@vitest/browser-playwright`, Chromium) + vitest-browser-react + axe-core | Keyboard behavior, ARIA, WCAG rules for each component state                     |
| Protocol contract         | Shared fixtures; insta (Rust) and Vitest (TypeScript)                                          | Compatibility of versions N and N−1 (NFR-12)                                     |
| Rust unit and integration | cargo-nextest 0.9, insta 1.49                                                                  | Holder, core, persistence, bootstrap                                             |
| Daemon over real SSH      | Vitest integration project with `sshd` in a container on Linux CI                              | US-1.1–US-1.5 end to end; no listeners (SEC-01)                                  |
| App end to end            | Playwright 1.65 `_electron` + `@axe-core/playwright` 4.14 + ARIA snapshots                     | User-story flows; WCAG 2.2 AA rules on every view; tree snapshots (PRD §11.2)    |
| OS accessibility tree     | `tools/ax-probe`: a Swift CLI reading `AXUIElement` attributes                                 | A11Y-04 and A11Y-06 attributes: selected text, ranges, caret, focus              |
| Screen readers            | Scripted manual passes per user story (PRD §11.3)                                              | Announcements, NFR-04 timing, everything automation cannot judge                 |

Notes:

- **The AX probe needs the macOS Accessibility permission.**
  - It runs in spike S2 and before every release on a Mac where that
    permission is granted.
  - It also runs in CI if the hosted runner allows the grant, which S2 checks.
- **Playwright's Electron support is still experimental.** It launches with
  `--inspect` and a remote-debugging port, which the release build forbids.
  - End-to-end tests run on a test build that differs only in that fuse.
  - Every signed release still gets a manual smoke test.
- **Commands for coding agents.**
  - Concise reporters: `vitest --reporter=agent`,
    `biome lint --reporter=concise`, `tsc --pretty false`.
  - Single tests: `vitest run <file> -t <name>`, `cargo nextest run <name>`.

### 9.7 Git hooks and AI-driven development

- **lefthook 2.**
  - `pre-commit` runs Prettier and `biome check --write` on staged files.
  - `commit-msg` runs commitlint 21 with `@commitlint/config-conventional`,
    which enforces the commit rules in CLAUDE.md.
- **No agent or editor configuration in git.** `.claude/` and other
  machine-specific files are git-ignored; lefthook is the only formatting hook.
- **Agent context.** CLAUDE.md lists the build, lint and single-test commands
  once the tooling lands.

### 9.8 CI on GitHub Actions (D-11)

| Runner                             | From | Jobs                                                              |
| ---------------------------------- | ---- | ----------------------------------------------------------------- |
| `macos-15` / `macos-26` (arm64)    | E1   | App build, signing, notarization, end-to-end tests                |
| `macos-15-intel`                   | E1   | x64 smoke test                                                    |
| `ubuntu-24.04`, `ubuntu-24.04-arm` | E1   | Daemon musl builds and tests, sshd integration, renderer tests    |
| `macos-15` / `macos-26` (arm64)    | E5   | Daemon universal2 build and tests                                 |
| `windows-2025`, `windows-11-arm`   | E6   | Windows app, ConPTY holder, Authenticode                          |

Caches: the pnpm store, Electron and electron-builder downloads, Playwright's
Chromium, and Cargo.

## 10. Adoption by epic

| Epic | What the epic adds to the stack                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| E1   | §4.1–§4.4; macOS packaging, ad-hoc signed, and manual downloads (§4.5, D-17); the protocol (§6) with backpressure flow control instead of skip-to-latest (D-19); SSH and bootstrap (§7); POSIX shell profiles (§8); `trcd core`, `bridge` and `holder` on Linux musl, the core started detached by the bridge, without kill-scope isolation (D-20); all tooling (§9) |
| E2   | Holders outside the kill scope and the Linux service-mode rule (§5.4); reconnect from an offset; skip-to-latest flow control (D-04) with `Resync` and `ReadRows` backfill; soak tests (NFR-11) |
| E3   | Persistence and restore (§5.5); daemon management; Electron's built-in updater on macOS (US-3.4)                                           |
| E4   | Shell-integration scripts and semantic events (§6, §8)                                                                                     |
| E5   | macOS `trcd` (universal2, LaunchAgent through SMAppService); local bridge; detached core on remote Macs                                     |
| E6   | Windows: ConPTY holders, named pipes, Windows profile detection, Windows helpers in `trcd`, installer and updater, Authenticode            |
| E7   | Linux desktop: AppImage, local systemd daemon, AT-detection fallback (R3), Linux updater                                                   |

## 11. Spikes

| ID  | Epic | Spike                                                                                                                                                      | Retires                     |
| --- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| S1  | E1   | libghostty-vt in Rust on musl x86_64/arm64: size, PSS per holder, VT round trip into xterm.js, matching grapheme widths and cursor columns, query replies   | D-02, US-1.11, NFR-09       |
| S2  | E1   | ATS selection and caret: every macOS attribute through the AX probe; Speak Selection, VoiceOver's read-selection command, Look Up, Services, Zoom caret tracking, dictation and IME | R1, A11Y-09           |
| S3  | E1   | Floods and churn with VoiceOver on: `yes`, a 1 GB `cat`, `tree /` at 100 ms RTT; tune the credit window, page size, cadence and selection cap; echo suppression | R2, R9, NFR-03, NFR-04 |
| S4  | E1   | `KnownHostsCommand` and `SSH_ASKPASS` behavior; the stderr message corpus for US-1.3; agent discovery for GUI launches                                     | US-1.2, US-1.3              |
| S5  | E1   | Bootstrap on Alpine/busybox, Ubuntu and RHEL; noexec home directories; LDAP users                                                                          | R10                         |
| S6  | E2   | A 1,000-cycle soak of daemon kill and upgrade, with and without lingering, and across logout                                                               | R4, R5, R6 (Linux), NFR-11  |
| S7  | E3   | Consistency of the persistence logs after a power cut                                                                                                       | NFR-08                      |
| S8  | E5   | `setsid` + `AbandonProcessGroup`; SMAppService registration; detached core on remote Macs                                                                   | R4, R5, R7 (macOS)          |
| S9  | E6   | ConPTY holder outside the app's job object; libghostty-vt on MSVC; re-verify the ATS with JAWS, NVDA and Narrator                                           | R1, R2, R4, R5, R8 (Windows) |
| S10 | E7   | Chromium AT detection and Orca on Wayland and X11; re-verify the ATS                                                                                        | R1, R2, R3 (Linux)          |

## 12. Decision log

| ID   | Decision                                                                                    | Why                                                                                      | PRD effect                |
| ---- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------- |
| D-01 | Rust daemon                                                                                 | Footprint, static binaries, ConPTY, memory safety (§2)                                   | Resolves OQ-2             |
| D-02 | libghostty-vt in the daemon; alacritty_terminal if it proves incompatible on a target OS    | Grapheme fidelity, VT formatter, small cells; a switch is possible in a later epic       | —                         |
| D-03 | JSON control messages with ts-rs types; raw I/O frames                                      | Fewest tools; NFR-12 met through the handshake and fixtures                              | —                         |
| D-04 | Lagging clients skip to the latest screen; programs never block                             | NFR-03 and fair sharing (US-2.6); gaps are backfilled from the daemon                    | —                         |
| D-05 | No encryption at rest; user-only permissions                                                | SEC-05 as written; remote hosts have no keychain the daemon can reach                    | Resolves OQ-1             |
| D-06 | Manual signed downloads in E1–E2; Electron's built-in updater on macOS from E3              | Simplest start. electron-updater's macOS path opens a loopback listener (SEC-01)         | Resolves OQ-3; adds US-3.4 |
| D-07 | Review mode is a paged, read-only text field with caret navigation                          | A single element holding the whole buffer froze NVDA; matches VS Code                    | Rewords A11Y-03.2         |
| D-08 | OS-visible selection is capped; copy is always exact                                        | Chromium can't hold 100k selectable lines                                                | Adds A11Y-04.7            |
| D-09 | No telemetry and no crash reporting                                                         | SEC-08; nothing in the PRD needs them                                                    | Resolves OQ-4             |
| D-10 | pnpm 12 workspaces; no task runner                                                          | Strict, fast, supply-chain settings                                                      | —                         |
| D-11 | GitHub for code, Actions for CI, Releases for downloads and the update feed                 | Hosted runners for every target OS and architecture                                      | —                         |
| D-12 | React 19 + React Aria Components                                                            | Accessible primitives; works with TypeScript 7; well supported by AI assistants          | —                         |
| D-13 | Biome is the only linter; no ESLint                                                         | typescript-eslint caps TypeScript below 6.1; jsx-a11y doesn't support ESLint 10          | —                         |
| D-14 | libghostty-vt source comes from its signed release tarballs, checked against a SHA-256 manifest and the minisign key; build.rs never touches the network | Reproducible, offline builds; no unverified download (SEC-04) | —                         |
| D-15 | Linux test hosts are sshd containers on a dedicated colima profile `trc`, ports on `127.0.0.1` only, keys generated per run | Real OpenSSH on Ubuntu, Alpine and Rocky without touching other profiles or exposing ports | —          |
| D-16 | In E1, CI workflows run only on manual dispatch; local `pnpm check`, integration and e2e suites are the gate | The GitHub repository arrived after planning; the local gates already cover E1 | —     |
| D-17 | E1 builds are ad-hoc signed (`codesign -s -`) and not notarized                             | No Developer ID identity yet; Apple silicon and the fuse flip need a signature           | E1 exception to SEC-04.1  |
| D-18 | Test builds read `TRC_TEST_SSH_CONFIG` and `TRC_TEST_KNOWN_HOSTS`; a build-time define removes the seam from release builds, and an artifact test checks it | OpenSSH reads `~/.ssh` from the passwd home, so tests need their own config | —   |
| D-19 | E1 flow control is backpressure: the holder pauses PTY reads when its single client runs out of credit. D-04 applies from E2 | E1 has one client per session; no line is skipped, so A11Y-02.3 and A11Y-03 need no backfill | —   |
| D-20 | In E1, `trcd bridge` starts the core detached (double fork, `setsid`, under a lock) when its socket is absent | Service-manager registration and kill-scope isolation arrive with E2 (US-2.4, US-2.5) | —     |

## 13. Versions (verified 2026-11-11)

**App and tooling (npm).**

| Package                        | Version | Package                              | Version |
| ------------------------------ | ------- | ------------------------------------ | ------- |
| electron                       | 45.3.1  | @xterm/xterm                         | 6.0.0   |
| typescript                     | 7.0.2   | @xterm/addon-webgl                   | 0.19.0  |
| @types/node                    | ~24     | @xterm/addon-unicode-graphemes       | 0.4.0   |
| vite                           | 8.3.8   | @xterm/addon-search                  | 0.16.0  |
| electron-vite                  | 6.0.0   | @xterm/addon-fit                     | 0.11.0  |
| electron-builder               | 26.18.0 | react, react-dom                     | 19.3.1  |
| @electron/fuses (CI check)     | 2.1.3   | react-aria-components                | 1.22.1  |
| pnpm                           | 12.18.0 | @vitejs/plugin-react                 | 6.3.0   |
| @biomejs/biome                 | 2.6.7   | zustand                              | 5.1.0   |
| prettier                       | 3.10.0  | react-intl                           | 12.1.7  |
| vitest                         | 5.1.0   | @formatjs/cli                        | 6.18.2  |
| @vitest/browser-playwright     | 5.1.0   | zod                                  | 4.6.7   |
| vitest-browser-react           | 2.3.0   | colorjs.io (dev)                     | 0.7.1   |
| @playwright/test               | 1.65.0  | lefthook                             | 2.2.2   |
| axe-core, @axe-core/playwright | 4.14.0  | @commitlint/cli, config-conventional | 21.2.4  |

**Daemon (crates.io and toolchains).**

| Crate or tool                 | Version | Crate or tool         | Version           |
| ----------------------------- | ------- | --------------------- | ----------------- |
| Rust                          | 1.99.1  | serde / serde_json    | 1.0.229 / 1.0.154 |
| Zig (build only)              | 0.17.1  | ts-rs                 | 12.0.1            |
| minisign (dev only)           | 0.12    | colima (dev only)     | 0.10.3            |
| docker CLI (dev only)         | 29.8.1  |                       |                   |
| cargo-zigbuild                | 0.24.1  | sha2                  | 0.11.1            |
| libghostty-vt                 | 1.0.1   | crc32fast             | 1.5.5             |
| alacritty_terminal (fallback) | 0.26.0  | tracing               | 0.1.44            |
| tokio                         | 1.54.1  | tracing-subscriber    | 0.3.23            |
| tokio-util                    | 0.7.20  | tracing-appender      | 0.2.5             |
| portable-pty                  | 0.9.0   | thiserror             | 2.0.21            |
| rustix                        | 1.1.6   | bindgen (one-off)     | 0.73.2            |
| windows-sys (E6)              | 0.61.2  | cargo-nextest / insta | 0.9.151 / 1.49.0  |

## 14. Not used, and why

| Rejected                                  | Reason                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| node-pty, napi-rs, any native Node module | PTYs live in the daemon; the app needs only Node built-ins                                        |
| xterm.js screen reader mode               | Its custom selection is invisible to the OS; its announcements are assertive and duplicated       |
| electron-updater                          | Its macOS updater serves the update over a loopback HTTP server (SEC-01)                          |
| `crashReporter`, Sentry, telemetry        | SEC-08; not required by the PRD                                                                   |
| ESLint, typescript-eslint, TypeScript 6   | Incompatible with TypeScript 7 and ESLint 10; Biome covers lint and a11y rules                    |
| React Compiler                            | Experimental, needs an extra native package; not needed for the PRD                               |
| Svelte, Vue, Lit, Solid                   | TypeScript 7 template checks (Svelte, Vue); shadow DOM breaks ARIA (Lit); Solid 2.0 not yet stable |
| Tailwind, CSS-in-JS, vanilla-extract      | CSS Modules and custom properties are enough                                                      |
| Protobuf, ConnectRPC, gRPC, Cap'n Proto   | More tooling than the protocol needs (§6)                                                         |
| ssh2, russh                               | They don't read `ssh_config` or support the user's full key setup                                 |
| SQLite                                    | Needs a C build; nothing is queried                                                               |
| Turborepo, Nx, Bun                        | One app and one daemon need no task graph and no second runtime                                   |
| Storybook                                 | A second build; its a11y run can skip silently                                                    |
| Guidepup screen-reader automation         | Pre-1.0, needs a dedicated Mac for VoiceOver; the PRD gates on scripted manual passes (§11.3)     |
| Electron Forge                            | Squirrel-only updates and more packages than electron-builder                                     |

## 15. Key sources

- **xterm.js:**
  - [releases](https://github.com/xtermjs/xterm.js/releases)
  - [AccessibilityManager.ts](https://github.com/xtermjs/xterm.js/blob/master/src/browser/AccessibilityManager.ts)
  - [flow control guide](https://xtermjs.org/docs/guides/flowcontrol/)
  - [PR 4340](https://github.com/xtermjs/xterm.js/issues/4340)
- **VS Code:**
  - [native EditContext](https://github.com/microsoft/vscode/tree/main/src/vs/editor/browser/controller/editContext/native)
  - [pty host starter](https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/electron-main/electronPtyHostStarter.ts)
  - [terminal accessibility](https://code.visualstudio.com/docs/configure/accessibility/accessibility)
- **Chromium:**
  - [browser_accessibility_cocoa.mm](https://source.chromium.org/chromium/chromium/src/+/main:ui/accessibility/platform/browser_accessibility_cocoa.mm)
  - [UIA support](https://developer.chrome.com/blog/windows-uia-support-update)
  - [ariaNotify](https://developer.mozilla.org/en-US/docs/Web/API/Element/ariaNotify)
- **libghostty:**
  - [1.0 announcement](https://mitchellh.com/writing/libghostty-1-0)
  - [API and formatter](https://lib.ghostty.org/vt/)
- **Electron:**
  - [releases](https://releases.electronjs.org/)
  - [utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)
  - [autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater)
  - [fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)
  - [nativeTheme](https://www.electronjs.org/docs/latest/api/native-theme)
- **Squirrel.Mac:** [static JSON feed](https://github.com/Squirrel/Squirrel.Mac#update-file-json-format)
- **TypeScript:** [7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- **Biome:**
  - [cognitive complexity](https://biomejs.dev/linter/rules/no-excessive-cognitive-complexity/)
  - [rule sources](https://biomejs.dev/linter/rules-sources/)
- **OpenSSH:**
  - [ssh_config(5)](https://man.openbsd.org/ssh_config)
  - [readpass.c](https://github.com/openssh/openssh-portable/blob/master/readpass.c)
  - [sshconnect.c](https://github.com/openssh/openssh-portable/blob/master/sshconnect.c)
- **systemd:**
  - [systemd-run](https://www.freedesktop.org/software/systemd/man/latest/systemd-run.html)
  - [kill modes](https://www.freedesktop.org/software/systemd/man/latest/systemd.kill.html)
- **Prior art:**
  - [zmx](https://zmx.sh/architecture)
  - [shpool](https://github.com/shell-pool/shpool)
  - [tmux control mode](https://github.com/tmux/tmux/wiki/Control-Mode)
  - [mosh](https://mosh.org/)
- **Testing:**
  - [Playwright Electron](https://playwright.dev/docs/api/class-electron)
  - [Vitest browser mode](https://vitest.dev/guide/browser/)

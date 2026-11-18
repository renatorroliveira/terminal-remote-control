# Terminal Remote Control — Tech Stack

| Field        | Value                                                                           |
| ------------ | ------------------------------------------------------------------------------- |
| Status       | Decisions accepted (v1.10). S1–S8, S11–S13 done (§11); S14 in E5; S9–S10 later. |
| Owner        | Renato Oliveira                                                                 |
| Last updated | 2026-11-18                                                                      |
| Requirements | [PRD.md](PRD.md). It sets the scope: nothing beyond it is built.                |

This document records the technology choices for P0 and why each one was made.
Versions were checked against the npm registry and crates.io on 2026-11-11.
The rule throughout: **one choice per need, and a fallback only where a spike
may force a switch.** Requirement IDs (`A11Y-*`, `SEC-*`, `NFR-*`, `US-*`,
`R*`, `OQ-*`) refer to the PRD.

The product is Terminal Remote Control, TRC for short (OQ-5): `trcd` is the
daemon binary and `~/.trc/` the per-user data directory.

---

## 1. Summary

| Layer               | Choice                                                                                             | Main reason                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Languages           | TypeScript 7 (app), Rust (daemon), POSIX `sh` (bootstrap, SSH helpers)                             | Each runs where it must, with the smallest footprint                 |
| Desktop runtime     | Electron 45 (Node 24, Chromium 156)                                                                | Owner's baseline; Chromium accessibility on every desktop OS         |
| Terminal view       | xterm.js 6 with WebGL, plus our own Accessible Text Surface (ATS)                                  | Proven emulation; OS-visible text, selection and caret (A11Y-01..06) |
| UI                  | React 19 + React Aria Components, Zustand, react-intl, CSS Modules                                 | Strongest accessible primitives; best support from AI assistants     |
| SSH                 | System OpenSSH client, one exec channel per host                                                   | Uses the user's config, agent and keys unchanged (US-1.1, SEC-03)    |
| App↔daemon protocol | Length-prefixed frames: JSON control (types from Rust via ts-rs), raw I/O                          | Simplest contract that still meets NFR-03 and NFR-12                 |
| Daemon              | Rust: tokio, rustix PTYs, libghostty-vt (fallback alacritty_terminal)                              | Small static binary, low memory (NFR-09), memory safety              |
| Persistence         | Per-session append-only files; no database; no encryption                                          | Meets NFR-08 and SEC-05 with the least machinery                     |
| Build               | pnpm 12, electron-vite 6 (Vite 8), electron-builder 26, cargo-zigbuild                             | Fast feedback, one tool per job                                      |
| Lint and format     | Biome 2.6 (lint, a11y, cognitive complexity ≤ 10), Prettier 3.10                                   | Owner's baseline; no ESLint needed                                   |
| Tests               | Vitest 5, Playwright 1.65 + axe-core, nextest, a macOS AX probe                                    | Covers DOM, OS accessibility tree, protocol and daemon               |
| CI and releases     | GitHub Actions and GitHub Releases                                                                 | Hosted macOS, Linux and Windows runners                              |
| Updates             | Manual ad-hoc-signed 0.x downloads until 1.0.0; Electron's built-in updater with E8 (US-8.5, D-43) | Owner's decision; the built-in updater opens no listener (SEC-01)    |

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
│   clipboard, nativeTheme relay, updater (E8) │            │   stdio ⇄ core socket         │
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
    - The macOS build arrives with local sessions in E4 (§7.4 of the PRD).
- **Local sessions (E4 onward).** Same path: the connection host spawns
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
    - A small hand-written `src/shared/contract.ts` maps each channel to its
      request and response types.
    - The preload exposes it through `contextBridge` as `window.trc`.
    - `ipcMain.handle` validates every payload with zod and refuses senders
      that are not the app's own page (`app://trc`, or the dev server in
      development).
    - The menus send commands (`app:command`) and the display relay sends
      `display:changed` to the renderer.
- **Renderer ⇄ connection host.**
    - Main creates a `MessageChannelMain`. The preload forwards one port to the
      page with `window.postMessage`, Electron's pattern for context-isolated
      pages.
    - Main sends a fresh port after every page load (`init` the first time,
      then `port`), so a reload reaches the same connections.
    - The contract is `src/shared/connection.ts`: `HostRequest` from the
      renderer (connect, send, input, credit, accept or reject a host key,
      disconnect) and `HostEvent` back (state, message, output, refused).
      Requests are validated with zod; the renderer never sends `hello` and
      uses request IDs below 2³¹, which the connection host keeps for pings.
    - Input for a host that is not connected is refused, never queued
      (US-1.14).
    - Output is throttled with a leading edge (D-28): output that arrives
      while idle posts at once, so a keystroke echo never waits; output in
      the next 5 ms is joined per session and posted when that window ends,
      like VS Code's `TerminalDataBufferer`. Pending output is flushed before
      every state or control message so ordering holds.
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
    - `pnpm verify:artifact` reads them from the packaged app with
      `@electron/fuses` (ST-20).
- **No debugging listener in releases.** `--remote-debugging-port` is a
  Chromium switch, not a fuse, so the main process of a release build removes
  it, `--remote-debugging-pipe` and `--remote-allow-origins` before the browser
  starts its DevTools server; test builds keep them for Playwright. The SEC-01
  "no listening sockets" check (`pnpm verify:artifact`) launches the packaged
  app with every debugging switch, not the Playwright test build.
- **The test seam is absent from releases.** Only test builds call
  `readTestSeam`, so release builds drop it with every `TRC_TEST_*` name, and
  `pnpm verify:artifact` fails on any that remains (P-14).
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
    - Resizing is our own fitter (`grid-fit.ts`, `terminal-geometry.ts`), not
      `@xterm/addon-fit`: the grid is at most 140 columns (P-48), centered in the
      terminal area, and drops columns when the space or a zoom leaves less
      room (A11Y-07.5). Hidden terminals keep their layout size
      (`visibility: hidden`), so they keep their grid.
    - xterm.js floors the glyph advance to device pixels, which cuts glyphs
      of a font with a fractional advance; the fitter adds the missing
      device pixel as `letterSpacing`.
    - `@xterm/addon-webgl` 0.19.0 carries a one-line `pnpm patch` (D-26).
- OSC 8 links go through `linkHandler`. OSC 52 uses `registerOscHandler` and is
  off by default (SEC-06).
- Terminal instances live in a `Map` outside React, so React never renders
  terminal DOM.
- **The daemon answers terminal queries.** The holder's emulator replies to DA,
  DSR/CPR, XTVERSION and OSC color queries, so programs never hang while no
  client is attached and never get duplicate replies.
    - The renderer swallows those queries with `registerCsiHandler`,
      `registerOscHandler` and `registerDcsHandler` handlers that return
      `true`: DA1, DA2, DA3, DSR, XTVERSION, DECRQM, the kitty keyboard query,
      DECRQSS, XTGETTCAP, and OSC 4, 10, 11, 12, 17 and 19 queries. OSC 52 is
      always swallowed in the renderer.
    - Title reporting and the other echo-back reports stay disabled in both
      emulators (SEC-06.3). xterm's `windowOptions` keep their all-off defaults.

**xterm.js's own screen reader mode stays off.**

- Its selection is a custom model that the OS cannot see.
- Its live region is assertive and stops after 20 rows.
- It reads content twice and uses list roles.

**Accessible Text Surface (ATS).** Our own layer, and the single focus target
of each terminal. Spike S2 verified it on macOS ([S2](spikes/S2.md)).

- **Element.** A `contenteditable` `div` with `role="textbox"` and
  `aria-multiline="true"` (D-22). Its name and description carry the session
  name, host and state (A11Y-01). Chromium exposes it as `AXTextArea`, with
  the name in `AXTitle` and `AXDescription`; the description is not exposed
  as `AXHelp`, which ST-10 resolves.
- **Placement.** Transparent text sits exactly over the WebGL canvas in the
  same cell metrics, so pointer reading (Speak items under the pointer) hits
  real text.
- **Content.**
    - One text node per row: the viewport plus overscan, **plus every row of the
      current selection, up to the selection cap**.
    - Chromium exposes `AXSelectedText`, `AXSelectedTextRange` and
      `AXSelectedTextMarkerRange` for the ATS. The ATS owns the DOM selection.
    - Row text changes use minimal `replaceData` edits, so a caret inside a
      changing row keeps its offset.
- **Input** (A11Y-09, D-22).
    - Every `beforeinput` is cancelled and its data sent to the PTY, so no input
      edits the DOM. IME text is sent once on `compositionend`, and the next
      update restores the row the composition touched.
    - EditContext is not used: in Chromium's full accessibility mode it reports
      no caret bounds, and macOS Zoom jumped away from the cursor on every
      keystroke (S2).
    - A small key encoder, ported from xterm's MIT `Keyboard.ts`, reads
      `term.modes` and sends the bytes.
    - xterm's helper textarea is out of the tab order and hands focus to the
      ATS. The ATS sends the DECSET 1004 focus reports; xterm's own are dropped.
    - While a program tracks the mouse, the ATS lets the pointer through to
      xterm, which reports it. Otherwise the wheel scrolls the buffer.
- **Selection** (A11Y-04).
    - Selection changes in xterm (`onSelectionChange`) are mirrored into the DOM
      with `setBaseAndExtent`.
    - DOM selection changes made by assistive technology, the keyboard or the
      pointer flow back through `term.select()`.
    - While the primary pointer button is down, the DOM selection leads and is
      never rewritten; rewriting it cancels Chromium's native drag.
    - A non-collapsed DOM selection the app did not set is mirrored, never
      replaced by the caret.
    - Typing clears the selection and returns the caret to the cursor in one
      selection change.
    - Look Up and Services work from the DOM selection:
      `webContents.showDefinitionForSelection()` and the `services` menu role.
    - Size cap (D-08):
        - The OS sees at most 5,000 selected lines (S3a: 42 ms to expose).
        - Copy always copies the full selection, and the cap is announced
          (A11Y-04.7).
- **Caret** (A11Y-06).
    - With no selection, a collapsed DOM caret sits at the terminal cursor. That
      drives `AXSelectedTextRange` and, through `AXBoundsForTextMarkerRange`,
      magnifier tracking and the IME and dictation UI. Chromium's index-based
      bounds and line attributes are unusable for this element.
- **Announcer** (A11Y-02, A11Y-12, D-37).
    - Reads the open session's new output from xterm.js's buffer once it
      settles (100 ms after the last write, at most 250 ms after the first):
      the logical lines from a marker at the cursor's line to the cursor, so
      redraws, cursor moves and overwrites collapse to each line's final text.
    - Leaves out the shell echo of typed characters (R9): typed text waits up
      to 2 s for its echo, which is removed from the start of the cursor line's
      new text.
    - Collapses floods into a summary ("312 lines of output"): more than 20
      lines in one second (ST-18 makes it a setting) holds the lines until
      output pauses for 500 ms.
    - In the alternate screen it reads the line at the cursor when the cursor
      moves to another line or that line changes, and nothing while the
      program hides the cursor.
    - Background and muted sessions stay silent and never speak that output
      later; the screen a session restores on attach is not spoken. A key
      press drops output still waiting to be spoken (A11Y-02.6).
    - Speaks through `Element.ariaNotify()`, available since Chromium 141. If
      VoiceOver drops notifications, the fallback is one persistent polite live
      region.
    - The UI's status messages go through the same announcer, at most one
      every 500 ms; a session's output waiting there is joined line after line.
- **Screen-reader mode** (A11Y-10.2). Spoken output follows Chromium's
  accessibility support, which any assistive technology turns on, unless
  `screenReaderMode` in `config.json` (set from the command palette until the
  ST-18 settings page) or `--screen-reader-mode=on|off|auto` forces it. A
  change is announced.
- **Review mode** (A11Y-03, D-07, D-40).
    - A read-only `<textarea>` over the terminal (D-40), holding a page of 500
      logical lines around the review caret. It re-pages when the caret comes
      within 50 lines of an edge, like VS Code's Accessible View, and
      Command+Up and Command+Down reach the start and end of the whole buffer.
    - Selection and copy are the text field's own; a page stays under the
      selection cap.
    - Screen readers navigate it with caret commands in focus mode. NVDA switches
      to focus mode on its own for read-only editable text.
    - Find (Command+F) searches the logical lines, selects the match in the
      terminal or moves the review caret to it, and announces "Match 3 of 17".
    - The page is bounded because a prototype that put the whole buffer into one
      `contenteditable` froze NVDA for 15–60 s (xterm.js #4340).
- **Update cadence** (R2). Chromium re-serializes every changed accessibility
  node.
    - The renderer learns that AT is running from
      `app.isAccessibilitySupportEnabled()` and its change event, relayed over
      IPC.
    - Without AT, the ATS updates once per animation frame.
    - With AT running, it updates at most about 4 times a second and holds still
      while a flood lasts. Output within 300 ms of a keystroke is its echo and
      still updates on the next frame, so the caret and the typed text reach
      the screen reader and the magnifier at once (D-28).
- **Links** (US-1.12.3, US-1.12.4, SEC-06.2, D-38). The renderer tracks OSC 8
  hyperlinks through xterm.js's public OSC hook (markers keep their rows) and
  detects URLs of any scheme in the logical line. A Command+click on the ATS
  (Control+click elsewhere) hit-tests the grid cell; while a program takes the
  mouse, xterm.js's own link provider and `linkHandler` route the same
  modifier+click. The main process normalizes every target, refuses
  `javascript:`, `vbscript:`, `data:`, `blob:` and the app's scheme, and opens
  the rest with `shell.openExternal` only after a confirmation, unless the
  target starts with a prefix in `accept_urls.json` in the TRC home.
- **Always on.** The ATS and the DOM selection stay active without a screen
  reader, so Speak Selection and Look Up always work. Announcements depend on
  Chromium reporting AT, or on the manual screen-reader setting (A11Y-10).
- **Minimum contrast** (A11Y-07).
    - xterm.js `minimumContrastRatio` is set to 4.5.
    - xterm.js halves that floor for dim (SGR 2) text, and A11Y-07 needs the
      full floor. pnpm patches on `@xterm/xterm` and `@xterm/addon-webgl`
      remove the halving in the DOM and WebGL renderers (D-39), and a test
      fails if an upgrade brings it back.
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
      (US-5.4);
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
    - Messages are `defineMessages` with explicit IDs. `pnpm --filter
@trc/desktop i18n` extracts them to `apps/desktop/lang/en.json` and compiles
      them to `src/renderer/i18n/compiled/en.json`; `pnpm check` fails when
      either is stale.
    - The main process keeps its menu strings in one module,
      `src/main/strings.ts`.
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
    - The palettes live in `src/renderer/ui/themes.ts`, the single source for
      the contrast test and the generated `@layer tokens` style sheet. A
      view's primary button uses the `primary`, `primaryText` and
      `primaryBorder` tokens, and every other button the `secondary` ones;
      `ui/buttons.ts` holds the shared button classes, whose base styles sit
      in `:where()` so component classes can adjust them. Layers
      are `reset, tokens, base, components`; the reduced-motion override is
      unlayered so it beats component animations without `!important`.
    - App state files (P-18) go through one `JsonStore`: zod-validated reads
      that fall back to defaults, atomic writes, mode 0600 in a 0700
      directory, the TRC home (`~/.trc`, or `TRC_HOME`; D-33). `config.json`
      holds the settings page's settings (`src/shared/settings.ts`), the
      screen-reader mode, the sidebar layout and whether the first-quit notice
      was shown (US-2.1.5), each field falling back to its own default; `hosts.json` holds the known hosts (address, port, install
      location and OSC 52 permission), which the main process serves over the
      `hosts:*` channels; `sessions.json` holds each host's sessions as last
      listed (ID, name, title, shell name, order and state, nothing more; P-30),
      over `sessions:load` and `sessions:save`, so they show at launch before
      their host connects.
    - The settings page (A11Y-10.3) reads and changes settings over
      `settings:get` and `settings:set`. A change must name known settings,
      each exactly within its range (`src/main/settings-schema.ts`), or it is
      refused. The renderer's `SettingsStore` applies a change at once, then
      keeps it; terminals, the shell and the workspace read it from there.
    - Sound cues (A11Y-12.4) are short sine tones made with Web Audio, with no
      sound files (P-18): rising for a connection, falling for a loss, low for
      a refused keystroke, each under 3 s and beside an announcement or a
      visual sign. They are off by default; a volume setting scales them. Earlier versions' files in their `@trc/desktop`
      profile are copied in once. Logs and Chromium's own data stay in
      `~/Library/Application Support/Terminal Remote Control`, named by the
      package's `productName`.

### 4.5 Packaging, signing and updates

- **electron-vite 6** builds main, preload, the utility process and the
  renderer with Vite 8, with hot module replacement in the renderer.
    - The dev server binds to `127.0.0.1` and exists only in development.
    - Packaged builds load from `app://` and open no listener (SEC-01).
- **electron-builder 26** packages, signs and notarizes.
    - **macOS (E1).**
        - Developer ID signature with the hardened runtime, notarized with an App
          Store Connect API key, from 1.0.0 (E8, US-8.3). 0.x builds are ad-hoc
          signed and not notarized under the pre-1.0 exception (D-17, D-43).
        - The entitlements are `com.apple.security.cs.allow-jit`, plus
          `com.apple.security.cs.disable-library-validation` while builds are
          ad-hoc signed: the hardened runtime otherwise refuses to load the
          Electron framework, whose ad-hoc signature has no team ID.
        - `signIgnore` keeps the app's signing off `Resources/daemon/`: the
          macOS daemon keeps the signature its build gave it (D-54), so its
          bytes stay those `manifest.json`'s SHA-256 names, which the bootstrap
          checks before it installs the daemon (SEC-04.3).
        - Outputs a dmg for installs and a zip as the update payload.
        - Electron fuses, set in `electron-builder.yml` and checked on every
          release package by `pnpm verify:artifact`: `runAsNode`,
          `enableNodeOptionsEnvironmentVariable`,
          `enableNodeCliInspectArguments` and
          `grantFileProtocolExtraPrivileges` off;
          `enableEmbeddedAsarIntegrityValidation` and `onlyLoadAppFromAsar` on.
        - No fuse covers Chromium's `--remote-debugging-port`, so release
          builds strip it at the top of the main process, before Chromium reads
          its switches (`debugging-guard.ts`). That relies on Electron's startup
          order: after an Electron upgrade, `pnpm verify:artifact`, which
          launches with the switch, must still find no listener.
        - electron-builder sets `NSAllowsArbitraryLoads` in `Info.plist` for
          electron-updater and overrides `extendInfo` to do so. App Transport
          Security governs only Apple's URL loading, not Chromium's network
          stack, and the app loads nothing over the network
          (`network-guard.ts`, CSP), so it is left as electron-builder sets it.
        - Ships `notices/THIRD_PARTY_NOTICES.txt`, generated by `tools/notices`
          (`pnpm notices`) from `pnpm licenses list --prod`, the daemon's normal
          crate dependencies in `cargo metadata`, libghostty-vt with the libraries
          built into it, and the fonts; `pnpm check` and CI fail while it is stale.
          Electron's own `LICENSE.electron.txt` and `LICENSES.chromium.html` sit
          beside it.
    - **Windows (E6).** A per-user install with no administrator rights
      (SEC-07). E6 chooses an installer format that E8's updater can drive;
      signing through Azure Artifact Signing comes with E8 (US-8.3, US-8.5).
    - **Linux (E7).** A user-level install with no root (SEC-07.1), so an
      AppImage. deb and rpm packages need root to install. Packaging comes in
      E7; signing and updates in E8 (US-8.3, US-8.5).
- **Daemon binaries.**
    - They ship under `Contents/Resources/daemon/<os>-<arch>/` via
      `extraResources`, with a SHA-256 manifest inside the signed bundle
      (SEC-04).
    - Linux ELF files are sealed as resources by the bundle signature.
    - The macOS daemon (E4) is listed in `mac.binaries`, so it gets a Developer
      ID signature and the hardened runtime.
- **SSH helpers.** `askpass` and `known-hosts` are POSIX `sh` scripts in
  `Contents/Resources/bin/` (§7). On Windows (E6) they become `trcd`
  subcommands, because the Windows daemon ships in that epic.
- **Updates (D-06).**
    - **Until 1.0.0 (D-43).** Users download 0.x alpha builds, ad-hoc signed,
      from GitHub Releases and install them by hand.
    - **E8 (US-8.5).**
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
    - **Windows and Linux.** E8 chooses their updaters under the same SEC-01 and
      SEC-07 constraints (US-8.5).
- **No telemetry, no crash reporting (D-09).** `crashReporter` is never
  started, because minidumps can hold terminal text (SEC-08).

## 5. Daemon (`trcd`, Rust)

### 5.1 Toolchain

- Rust stable 1.99, pinned in `rust-toolchain.toml`, edition 2024.
- **Linux:** static musl binaries for `x86_64` and `aarch64`, built with
  **cargo-zigbuild 0.24** and Zig 0.17. One binary per architecture runs on
  both glibc and musl hosts (PRD §7.2).
- **macOS (E4):** a universal2 binary built on a macOS runner.
- **Windows (E6):** an MSVC build.
- Not used: `cross` (unmaintained) and cargo-dist (not needed).

### 5.2 Crates

| Need                                                                    | Crate (version, license)                                         | Fallback (spike that decides)    |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------- |
| Async runtime, sockets, named pipes, processes                          | tokio 1.54 (MIT); tokio-util 0.7 (MIT) for framing               | —                                |
| PTY                                                                     | our own spawn on rustix 1.1 (D-23); ConPTY on windows-sys (E6)   | —                                |
| VT emulator, snapshots, persistence format                              | libghostty-vt 1.0.1 (MIT) through our own thin FFI crate         | alacritty_terminal 0.26 (S1, S9) |
| Unix calls (PTYs, setsid, modes, flock, fdatasync, poll, pipes, uname)  | rustix 1.1 (Apache-2.0/MIT)                                      | —                                |
| macOS calls rustix lacks (`proc_pidinfo`, `sysctlbyname`, `getpwuid_r`) | libc 0.2 (MIT/Apache-2.0), macOS only                            | —                                |
| Windows calls (pipe client PID, SIDs, ACLs, jobs)                       | windows-sys 0.61 (MIT/Apache-2.0)                                | —                                |
| Control messages and metadata                                           | serde 1.0 + serde_json 1.0 (MIT/Apache-2.0)                      | —                                |
| TypeScript types generated from Rust                                    | ts-rs 12 (MIT)                                                   | —                                |
| Checksums                                                               | sha2 0.11 (binaries and scrollback records)                      | —                                |
| Logging                                                                 | tracing 0.1, tracing-subscriber 0.3 (JSON), tracing-appender 0.2 | —                                |
| Errors                                                                  | thiserror 2                                                      | —                                |

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
- **Build (D-14).** `tools/fetch-libghostty.sh` downloads the release
  tarballs named in `tools/libghostty.manifest`, checks minisign and SHA-256,
  and extracts them into `~/.cache/trc/libghostty-vt/<version>/`
  (`TRC_CACHE_DIR` overrides). `ghostty-vt-sys`'s build script runs
  `zig build --system` there once per target, caches the static library and
  links it from `OUT_DIR`, so only the `.a` is visible to the linker.
- **Scrollback.** libghostty-vt prunes whole pages, which can keep up to about
  500 rows fewer than its line limit. `trc-vt` asks for the configured limit
  plus 1,024 lines, so a session always keeps at least what NFR-10 promises.
- Spike S1 confirmed D-02 ([S1](spikes/S1.md)): exact VT round trips into
  xterm.js and about 1.4 MB per idle holder. Every terminal turns on grapheme
  clustering (DEC mode 2027) by default, lifts the default 10,000-byte
  scrollback cap so the line limit governs, and formats snapshots as VT with
  every extra except the palette, without trimming. A palette in the snapshot
  would replay as OSC 4 and override the app's theme colors (A11Y-07).
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
  `run/holders/*.sock`. Each holder introduces itself on every connection with
  its spec and the user's name for the session, so a new core recovers both;
  the order falls back to start time. Sockets nobody serves are removed.
- One core per user: it holds an exclusive `flock` on `run/core.lock` (which
  also records its PID and, from E2, its version and SHA-256) for its lifetime, so a stale `core.sock` is removed
  safely. A second core exits with status 75.
- It creates its files with umask 077 and gives holders, and so their shells,
  the umask it inherited. Holders start in their own session, with an empty
  environment and `/` as the working directory.
- Session IDs are 16 hex digits from `/dev/urandom`, also used as holder
  socket names. Scrollback defaults to 10,000 lines and is capped at 100,000
  (NFR-10).

**`trcd holder`.** One per session. It owns the PTY or ConPTY, the shell, the
emulator (including query replies) and the persistence writer.

- It keeps reading output while the core is down (US-2.1, US-2.5).
- It never blocks on a slow client.
- It runs as `trcd holder --socket run/holders/<id>.sock`. The socket is
  created with mode 0600 under a temporary umask, so the shell keeps the umask
  the holder inherited. Only peers of the same uid are accepted (SEC-02), and
  the socket is removed on shutdown.
- It opens the PTY and spawns the shell itself (D-23): `openpt` with
  close-on-exec, then only `setsid` and `TIOCSCTTY` between fork and exec.

**`trcd bridge`.** Relays stdio to the core's socket, and starts the core if it
is not running, like `wezterm cli proxy`.

- In E1 (D-20) it runs `trcd core --detach`, which calls `setsid` and starts
  the real core, then exits. The core is then neither the bridge's child nor a
  session leader. Bridges racing to start a core share the one that wins the
  lock.
- It checks that the run directory is private and that the socket's peer is
  the same user before relaying.

**Integrity at start (SEC-04.4).** Every subcommand refuses to start if its
binary, its version directory, `versions/` or the install root is owned by
another user or writable by group or others, or if a folder above the root is
owned by anyone but the user or root, or is writable by group or others
without the sticky bit, as OpenSSH asks of the folders above a key file; it
exits with status 78. The
binary must sit at `<root>/versions/<version>/trcd`. `trcd --version` prints the
version and the binary's SHA-256 and runs anywhere.

**Linux service mode (US-2.4, D-44).** The app uses systemd only as the host
already has it: it never runs `loginctl enable-linger` and writes nothing
outside the install root.

1. If `loginctl show-user` reports `Linger=yes`, the bridge starts the core as
   a transient user unit, `systemd-run --user --unit trcd-<root hash>` with
   `Restart=on-failure`, so systemd restarts it after a crash.
2. If lingering is off and logind ends user processes at logout
   (`KillUserProcesses=yes`), the core runs the same way, under the user
   manager, which lives until the last connection closes; a detached core
   would die with the connection that started it. The core reports that
   sessions end when the last connection closes, and the app warns
   (US-2.4.4).
3. Otherwise, or without a systemd user manager, the core and holders run
   detached (`setsid`), as in E1, and survive logout.

**Staying out of the kill scope.**

- **Linux unit.** When the core runs as a unit, each holder starts through
  `systemd-run --user --scope --collect` before its shell, which takes it out
  of the unit's control group. tmux does the same. The unit runs with
  `KillMode=process`, so a holder that had to start directly, because its
  scope could not start, still outlives a stop or restart of the core (P-34).
- **macOS (E4).**
    - Holders call `setsid()`, and the LaunchAgent sets `AbandonProcessGroup`.
    - The core is a plain per-user LaunchAgent: a plist in
      `~/Library/LaunchAgents` running the installed `versions/<sha256>/trcd`,
      loaded with `launchctl bootstrap gui/<uid>`, with `RunAtLoad` and
      `KeepAlive` after any unsuccessful exit (D-50). SMAppService waits for E8's Developer ID
      signing, as it is reliable only for signed and notarized apps.
    - The Mac's own daemon uses the default install root `~/.trc`, beside the
      app's files, so other computers that add the Mac reach the same daemon
      (D-51).
    - The bridge registers the agent only where `launchctl print gui/<uid>`
      finds a GUI login session; otherwise the core runs detached, as on Linux
      (R7). The agent runs `trcd core --launchd`, with the bridge's `HOME`,
      `USER`, `LOGNAME`, `SHELL`, `PATH` and umask, `ProcessType` Interactive
      and its standard error in the install's private `logs/launchd.log`.
    - A bridge that finds the agent loaded but its core stopped (after Restart
      daemon) runs `launchctl kickstart`; a plist that changed, other than in
      the registering bridge's variables and umask, is booted out, rewritten and
      bootstrapped; an upgrade boots the old agent out first. No step ends a
      holder, and a logout ends only the core (S8, P-62).
    - `KeepAlive` restarts a core after any unsuccessful exit, within a second
      (`ThrottleInterval`). So under launchd a core that cannot start for a
      reason no retry fixes (another core runs, the install or a folder of it is
      not private, a path is missing or refused) exits with 0, while one the OS
      may get past (out of file descriptors, space, quota or memory; an
      interrupted, blocked, timed-out or busy call; a network home not up yet)
      exits with 71 and starts again. A core SIGTERM ended, by `kill`, Activity Monitor or
      `launchctl stop`, exits with 143 and starts again; at a logout or a
      `bootout` launchd unloads the job, which then never starts again. Unlike
      systemd, launchd sets no start limit; a starting core empties
      `launchd.log` once it passes 1 MiB, and the bridge creates that file
      0600 and passes its last lines, cut to 300 characters, into its error
      when the core never comes up.
    - Remove daemon boots the agent out and deletes its plist before deleting
      the install.
- **Windows (E6).**
    - Each holder owns its pseudoconsole and starts with
      `CREATE_BREAKAWAY_FROM_JOB | DETACHED_PROCESS`.
    - Microsoft's redistributable `conpty.dll` (MIT) ships next to the binary.

**Upgrade without session loss (US-2.5, D-46).**

1. Upload the new binary, verify it and rename it into `versions/<sha256>/`.
2. The new version's bridge reads `core.lock`. If the core holding the lock is
   older, it takes `run/upgrade.lock`, so one bridge at a time decides, reads
   `core.lock` again, and stops that core (its unit, or `SIGTERM` once its
   executable is found in this install's `versions/`, and only while that
   process still holds the lock). It waits for the lock and starts its own
   core. It never replaces a newer core, and a bridge that finds the unit
   restarting waits for that core instead of starting one.
3. The new core adopts every holder; it speaks holder protocol versions N and
   N−1.

Holders are never upgraded in place. An old session keeps its old holder until
it ends, and unused versions are deleted after that. VS Code Server uses the
same side-by-side layout.

We don't need `SCM_RIGHTS` handoff or the systemd fd store. The fd store keeps
descriptors alive, but shells inside the unit's control group still die.

### 5.5 Persistence (E3; SEC-05, NFR-08)

One directory per session, `<root>/sessions/<id>/` (mode 0700, files 0600):

- **`meta.json`**, written by the core, holds the shell profile snapshot,
  args, environment, working directory, size, name, order, the US-3.2
  options, the state and the boot ID. Each write goes to a temporary file, is
  fsynced, then renamed into place.
- **`scrollback.log`**, written by the holder, holds append-only records
  `[u32 length][first 4 bytes of the payload's SHA-256][payload]` ([S7](spikes/S7.md)).
  Each payload holds the history rows that left the primary screen since the
  record before and, when it changed, the primary screen, so the records up
  to any point are consistent.
    - Records are appended and `fdatasync`ed every 2 s while there is new
      output, so on-disk lag stays inside NFR-08's 5 s.
    - Reading keeps the records before the first one that is cut short or
      fails its check.
    - A whole new file replaces it (written beside it, synced, renamed) when a
      session starts or is restored, when what was appended outgrows a rewrite
      and the scrollback limit, after a resize, after Clear scrollback, and
      after a failed write.
- A writer thread does the file work, holding at most 4 MiB, so the PTY is
  never read late for the disk (D-04); a failed write is retried and
  reported, and the session keeps running.

Rules:

- Sessions with "Save scrollback to disk" off (US-3.2) write no
  `scrollback.log`, and turning it off deletes it.
- Closing a session deletes its directory.
- Restore (D-48) feeds the history and screen into a new holder's emulator,
  adds the marker line, then starts the shell. Commands are never re-run.
  A starting core restores every session no live holder serves, and a holder
  that dies while the core runs is restored in place, however recently it
  was restored; a session whose holder ended 3 times within 10 minutes is
  left Failed to start instead. Sessions that are not restored get a holder
  that runs no shell and serves their saved scrollback (P-41).

There is no app-level encryption, because SEC-05's user-only permissions are
the control (D-05, which resolves OQ-1). There is no SQLite either: it needs a
C build, and nothing is queried.

### 5.6 Local IPC and peer authentication (SEC-01, SEC-02)

**Socket.** `~/.trc/run/core.sock`, mode 0600 inside a 0700 directory.

- If the longest holder socket path would be too long for a Unix socket (104
  bytes on macOS, 108 on Linux), the whole run directory falls back to
  `/tmp/trc-<uid>/`. Every run directory must be a real directory owned by the
  user with mode 0700, so a directory someone else created there is refused.
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

- `tracing` writes JSON through `tracing-appender` to
  `<root>/logs/core.<date>.log`: daily rotation, seven files kept, mode 0600 in
  a 0700 directory.
- PTY bytes, keystrokes, environment values and clipboard data are wrapped in a
  `Sensitive<T>` type that prints `[redacted]`.
- Soak tests print canary strings and fail if any log contains one.
- Hosts get no config file; the app sends settings to the daemon.

## 6. App↔daemon protocol (D-03, D-04)

### Framing

One byte stream per daemon connection, made of frames:
`u32 length (big-endian) | u8 kind | u32 stream | payload`.

| Kind      | Payload                                 |
| --------- | --------------------------------------- |
| `CONTROL` | One JSON message (stream 0)             |
| `OUTPUT`  | Raw PTY bytes, at most 32 KiB per frame |
| `INPUT`   | Raw input bytes                         |
| `CREDIT`  | `u32` bytes granted to the sender       |

The connection host routes output after reading the 9-byte header, without
parsing JSON.

### Control messages

Control messages are tagged unions defined once as Rust `serde` types. ts-rs
exports the TypeScript types, which are checked in, so building the app never
needs Rust. Every request carries a `requestId`.

1. **Handshake.** `Hello { minProto, maxProto, appVersion, caps }`, answered by
   `Welcome { proto, daemonVersion, binarySha256, caps, service }` or
   `Incompatible { minProto, maxProto }`. From protocol 2, `service` says what
   runs the daemon and whether sessions end at logout (US-2.4); from 0.4.0,
   `details` names the account's home folder, the install root, the log folder
   and when the core started (US-3.3.1, P-48).
2. **Liveness.** `Ping` and `Pong`.
3. **Catalog.** `ListSessions` and `ListProfiles`. The daemon pushes
   `SessionEvent` (created, updated, closed, state) to every client (US-2.6).
4. **Lifecycle.** `Create`, `Rename`, `Reorder`, `Stop`, `Restart`, `Close`.
   Requests that return nothing else are answered by `Done`.
    - From protocol 3 (E3): `options { restore, saveScrollback }` on `Create`
      and on every session, `SetSessionOptions`, `ClearScrollback`,
      `restored { at, afterHostRestart }`, `persistenceFailure`, and an `ended`
      cause on the exit status of a session its processes ended without
      (US-3.1, US-3.2).
    - `RestartDaemon` and `RemoveDaemon` manage the host's daemon (US-3.3).
    - The daemon still speaks protocols 1 and 2 (P-49).
5. **Attach.**
    - `Attach { session, mode: full | events }`, answered by
      `Attached { stream, credit }`. The screen snapshot follows as ordinary
      `OUTPUT` frames on that stream, before live output, so its size is never
      bound by the control-frame limit (1 MiB).
    - From protocol 2 (E2): `fromOffset` on `Attach`, and `replay` (`delta`
      or `snapshot`) on `Attached`.
    - `Detach` and `Resize`.
    - `Refresh { session }`, which asks for the whole scrollback and screen
      again (D-45).
    - Reconnecting is an `Attach` with `fromOffset` (US-2.2): the daemon
      replays the output since that offset when it still holds it, and
      otherwise sends a snapshot. Either ends with `Synced { offset }`.
    - `Resync { kind: screen | full }` starts the resync of a client that fell
      behind (D-04); it also ends with `Synced`.
    - `PeerInput` tells the other clients of a session that someone typed,
      at most once a second (US-2.6.4).
    - `Detached { reason }` tells a client the daemon ended its attachment:
      `attachedElsewhere` when another client opened a session whose E1
      holder serves one client at a time (P-27, P-34).
6. **Semantic events (protocol 4, E5, D-57).** The holder reads OSC 133, OSC 7,
   iTerm2's OSC 1337 `CurrentDir`, `RemoteHost` and `SetMark` (OQ-6), OSC 0/2
   and BEL.
    - Title and working folder stay fields of `SessionInfo`; `integration`
      joins them (`injected`, `native`, `off` or `unsupported`).
    - `Bell` (at most one a second) and `CommandFinished { exitCode, durationMs }`
      reach every protocol 4 client as `SessionEvent` `event` changes, whether
      or not it attached the session, so background sessions need no
      attachment and 25 hosts × 100 sessions stay cheap (NFR-05). The `events`
      attach mode stays reserved.
    - No command line is kept, sent or logged.
7. **Errors.** `Error { requestId, code, message }`.

### Flow control (D-04: skip to latest)

- **Credit.** Each attached stream gets a 1 MiB window (S3b: at 100 ms RTT a
  256 KiB window held output to about 2 MiB/s, 1 MiB reaches about 8 MiB/s, and
  OpenSSH's 2 MiB channel window bounds it beyond that). The renderer returns
  credit from xterm.js write callbacks in 64 KiB steps, as VS Code and the
  xterm.js flow-control guide do.
- **No blocking.** The holder never stops reading the PTY. Programs never
  block, and one slow client never slows the others (US-2.6).
- **Resync.** A client that runs out of credit gets nothing more until it
  catches up. It then receives `Resync` with the current screen instead of the
  backlog, as mosh does.
- **Gaps (D-45).** Scrollback skipped this way is filled by rebuilding the
  client's terminal from the whole scrollback and screen (`Refresh`), streamed,
  once output pauses. Opening review mode or find rebuilds first, so both see
  every line even during a sustained flood (A11Y-02.3, A11Y-03). xterm.js cannot
  insert rows into the middle of its buffer, so fetching single rows would not
  help.
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
- **TypeScript side.** ts-rs (features `serde-compat`, `no-serde-warnings`;
  `TS_RS_LARGE_INT=number`) writes the types to
  `packages/protocol/src/generated/`, which Biome and Prettier skip.
  `pnpm check` fails when they differ from the committed files. Optional
  fields use zod's `exactOptional()` to match `exactOptionalPropertyTypes`.
- **Fixtures.** A shared corpus (`protocol/fixtures/v<N>/`) is checked by both
  sides: golden-file tests in Rust (`TRC_BLESS_FIXTURES=1` rewrites them) and
  Vitest in TypeScript. N−1 fixtures stay until
  N+1 ships.

**E1 (D-19).** E1 attaches one client per session, so it uses backpressure
instead of skip-to-latest: when the client's credit runs out, the holder stops
reading the PTY until credit returns, and programs block as in any terminal.
`INPUT` and `CONTROL` still never queue behind `OUTPUT`. `Resync` and "never
block" arrive in E2 with multiple clients; protocol 1 clients of an E2 daemon
get an in-band reset and the full snapshot when they catch up.

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
- **Jump hosts (D-21).** ssh starts a `ProxyJump` connection with only `-F`
  and `-W`, so command-line `-o` options never reach it (S4). The connection
  host therefore also writes a per-connection wrapper config: a `Host *` block
  with every option above, then `Include ~/.ssh/config` and
  `Include /etc/ssh/ssh_config`. It passes the wrapper with `-F` and keeps the
  `-o` options. The first value obtained wins, so the jump connection gets the
  same protections and reports its host key through the helper.
- ssh splits the command line itself without a shell, so the helper path is
  quoted for the spaces in the app name.
- The helper prints `%H %t %K` on stderr behind a per-connection nonce and
  returns no keys. It ignores the `%I=ORDER` call, whose key arguments are the
  literal `NONE`.
- BatchMode then refuses the unknown key, and the app shows its accessible
  dialog.
- Accepting appends the key to the first `UserKnownHostsFile` from `ssh -G`
  (hashed as `|1|salt|hmac` if it reports `hashknownhosts yes`) and
  reconnects. Only the key this connection was presented can be accepted; the
  renderer sends back its fingerprint, computed by the app from the key.
- A changed key is refused, with no override.
- `ssh-keyscan` is not used, because it ignores ProxyJump.

**FIDO keys (US-1.3).**

- In BatchMode, OpenSSH still sends its "Confirm user presence" notice to
  `SSH_ASKPASS`, with `SSH_ASKPASS_PROMPT=none`.
- The `askpass` helper relays that notice on stderr, and the app shows it as
  "Touch your security key for <host>".
- The helper refuses every other prompt by exiting non-zero without output.

**Diagnostics (US-1.3).**

- Failures are classified from stderr (ssh ends some lines with `\r\n`),
  tested on the S4 corpus: unknown and changed host keys, DNS, refused and
  timed-out connections, and jump-host failures (a named host that is not the
  target while `ssh -G` shows a `proxyjump`).
- A refused public key is explained by local checks in this order: an expired
  certificate (`ssh-keygen -L`, including `<IdentityFile>-cert.pub`); a
  passphrase key whose public key the agent does not hold, reported as no
  agent (`ssh-add -l` exit 2), an empty agent (exit 1) or a key not loaded; a
  security key (`sk-` type) that needs a PIN; no usable key at all; otherwise
  the host rejected the key.

**Configuration.**

- `ssh -G <alias>` gives the effective settings.
- The host picker walks `~/.ssh/config` and its `Include`s itself, about 60
  lines of code, because ssh has no listing command.
- `ssh -V` must report 8.5 or newer. On Windows (E6), Windows OpenSSH is
  spawned by absolute path.

**Liveness (NFR-07).** ServerAlive at 10 s × 2, plus an application `Ping`
every 5 s with a 15 s timeout, detect a dead connection within 30 s. The
integration tests pause a host container and check it.

**Lifecycle.** Each host connection is a discriminated-union reducer: idle,
connecting (steps `connecting`, `checking` once the host answers, `uploading`,
`verifying`, `starting`, `handshake`, with an optional security-key touch
notice), host-key, connected, failed, disconnected and closed.

**App log.** The connection host writes JSON lines to
`<userData>/logs/connection-host.log` (0600 in a 0700 directory): states,
steps and failure kinds only. Values wrapped in `Sensitive` serialize as
`[redacted]` (SEC-08).

**Startup-file noise.** Remote startup files can print to stdout. The bootstrap
prints a random nonce marker, and the app discards everything before it.

**Not used.** ssh2 (JavaScript) and russh (Rust). Neither reads `ssh_config`,
so either would mean reimplementing the user's SSH setup (US-1.1).

### Bootstrap (US-1.4)

`apps/desktop/resources/bin/bootstrap.sh`, a POSIX `sh` script, is piped to
`exec /bin/sh -s` over `ssh -T`. The app prepends `TRC_NONCE` (hex) and
`TRC_ROOT` (the per-host install location, absolute or `~/…`) as single-quoted
assignments. Every line for the app starts with the nonce, so startup-file
noise is ignored. The driver (`connection-host/bootstrap/`) sends nothing after
the script until it has read `HELLO`.

1. **Hello.**
    - `umask 077`. The root's folder is resolved to its physical path
      (`pwd -P`), which every later step uses, and every folder from there up
      to `/` must be owned by the user or root and be writable by group or
      others only with the sticky bit; `/` itself is refused as a root. If the
      root exists, it must be the user's, not a symlink, and not writable by
      group or others. Otherwise the script stops with `root-unsafe`, naming
      the folder, before running or reporting anything in it (SEC-04.4); it
      stops with `root-unusable` when the location cannot be created or
      written, or its parent is missing or cannot be entered. The rule is
      sshd's StrictModes rule, so a group-writable folder is refused even when
      the user is the group's only member. It reads mode bits only: on file
      systems whose permissions they don't show (CIFS `noperm`, FUSE
      `allow_other`, NFSv4 ACLs), and on macOS hosts with ACLs (E4), it can
      accept a folder others can write. A host whose `/` or `/home` belongs to
      a user other than root is refused.
    - Then `<nonce> HELLO os=… arch=… checksum=… installed=…`: `uname -s`;
      `x86_64`, `arm64` or `unsupported`; the checksum tool or `none`; and
      `<sha256>:<version>` pairs, comma-separated, or `-`. A version counts only
      when `versions/`, `versions/<sha256>/` and its `trcd` pass the same
      ownership and mode test and the binary matches its checksum; its version
      then comes from its `--version`.
    - An unsupported OS or architecture gets an error that names both, before
      anything is created.
2. **Commands**, one per line: `UPLOAD <size> <sha256> <version>` followed by
   exactly `<size>` bytes, `RUN <sha256>`, `REMOVE`, or `EXIT`.
3. **Upload.**
    1. Create the root (its parent must exist) and `versions/`, remembering
       which it created. Both must pass the ownership and mode test, and so must
       an existing `versions/<sha256>/` the upload replaces a binary in.
    2. Take an atomic `mkdir` lock, breaking it when its PID is gone and
       waiting up to 60 s (`sleep 1`).
    3. Read exactly the stated number of bytes (`head -c`, falling back to `dd`)
       into a staging directory.
    4. Verify the checksum with `sha256sum`, `shasum -a 256` or
       `openssl dgst -sha256`.
    5. `chmod 700`, then run `--version`. Exit code 126 means a noexec mount;
       the app points the user to the per-host install location setting (R10).
       The reported checksum must match.
    6. Rename into `versions/<sha256>/`.

    Progress lines are `PROGRESS receiving|verifying|testing`, then
    `INSTALLED <sha256> <version>`. On any failure, a trap removes the staging
    directory, the lock and the directories this run created.

4. **Run.** Check the version directory and binary pass the same test, print
   `RUNNING`, then `exec "$bin" bridge`. Protocol frames follow on
   the same channel.
5. **Remove (US-3.3.3, P-46).** Stop the core's systemd unit when there is
   one, then end, with SIGTERM and then SIGKILL, every process whose executable
   lies in the root's `versions/`. Delete `versions/`, `sessions/`, `logs/`,
   `install.lock` and `run/` (or, when the root has none, the `/tmp/trc-<uid>`
   fallback if the user owns it), then the root if it is empty. Answer
   `REMOVED`, or `REMOVED kept=<name>/<name>…` naming what the root still
   holds. The step works whether or not the core answers; the app first asks a
   protocol 3 core to stop every session and delete `sessions/` itself.
6. **Errors** are `ERROR <code> <detail>`, with the codes `unsupported-os`,
   `unsupported-arch`, `missing-tool`, `root-unusable`, `root-unsafe`, `noexec`,
   `checksum-mismatch`, `short-upload`, `lock-busy`, `self-test`,
   `not-installed` and `protocol`.

**The app's decision (US-1.4.6).** Run the bundled daemon when its SHA-256 is
installed; upload it when the host has none or only older versions; never
downgrade, so a newer installed version asks the user to update the app.

**The bundle (SEC-04.2).** `pnpm build:daemon` builds both musl targets with
cargo-zigbuild into `apps/desktop/resources/daemon/<linux-x64|linux-arm64>/trcd`
and writes `manifest.json` with the version and each binary's SHA-256 and size.

## 8. Shell selection (US-1.7, US-5.1, US-6.2, US-6.3)

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

- The daemon sets `TERM=xterm-256color`, `COLORTERM=truecolor`,
  `TERM_PROGRAM=trc` and `TERM_PROGRAM_VERSION`, plus `HOME`, `USER`,
  `LOGNAME` and `SHELL` from the account.
- Defaults that a login shell's startup files normally replace:
  `PATH=/usr/local/bin:/usr/bin:/bin` and `LANG=C.UTF-8`.
- Profile and then session overrides apply last; an override can also remove
  a variable.
- Sessions never inherit the daemon's environment. It carries stale `SSH_*`
  values from whichever connection started it.

**Shell integration (US-5.1, D-55).** Our own short scripts emit OSC 133
A/B/C/D and OSC 7. They are embedded in the daemon, written by the core to
`<root>/shell-integration/<digest>/` in its 0700 root, a folder named by the
scripts' SHA-256, and injected at every
shell start (create, restart, restore) without editing dotfiles.

- **bash 4 and later:** `--posix` with `ENV` naming our script, as kitty and
  Ghostty do; the script leaves POSIX mode and sources the startup files a
  login or interactive shell reads, so `-bash` stays a login shell, and never
  reads the system bashrc twice.
- **bash 3.2** (macOS `/bin/bash`, which ignores `ENV` when interactive): a
  non-login `--rcfile` that sources the login files itself, as VS Code does,
  with a `DEBUG` trap for the command start.
- **zsh:** `ZDOTDIR` points at a `.zshenv` that restores the user's `ZDOTDIR`,
  sources their `.zshenv` and adds the hooks at the first prompt.
- **fish:** `XDG_DATA_DIRS` adds our `vendor_conf.d`; fish 4 marks prompts and
  reports OSC 7 natively, so the script only fills in what fish 3 lacks.
- **pwsh (E6):** `-NoExit -Command ". '<script>'"`.
- **Other shells** (sh, ash, dash) get nothing, and command navigation says
  why.

A guard variable keeps the script from loading twice, and the holder ignores a
repeated prompt mark or an end without a start, so a user's own integration
(iTerm2's, for example) does no harm. Injection can be turned off per host
(US-5.1.3) and per profile. VS Code's scripts are not reused, because they emit
only OSC 633 and print environment values.

**Marks (D-56).** The holder keeps every command's prompt row, exit status and
times, and writes OSC 133 back into snapshots and saved history, which the
formatter does not do, so xterm.js and a restored session rebuild their marks
from the stream as live output builds them.

**Marks never trigger actions (SEC-06).** They drive navigation and
announcements only. OSC 1337 is read for `CurrentDir`, `RemoteHost` and
`SetMark` only, never `File=` or any other key, and OSC 633 is not read (OQ-6).

## 9. Tooling

### 9.1 Workspace

- **pnpm 12 workspaces (D-10).** Settings live in `pnpm-workspace.yaml`:
  `minimumReleaseAge` of one day for supply-chain safety, with each pinned
  version that is younger listed exactly in `minimumReleaseAgeExclude`, and
  `allowBuilds` for the only packages that run install scripts (electron,
  lefthook).
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
  resources/docs/         the user guide as HTML, generated from USER_GUIDE.md (D-41)
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
- **tart** runs the macOS test hosts as local VMs on Apple's Virtualization
  framework, from Homebrew's `openai/tools` tap with only its `softnet`
  formula trusted (D-52). Each VM is deleted after its run, and the base image
  at the end of E4. Development-only; royalty-free on personal machines. The VM
  runs on lima's user-mode network (`limactl usernet`, from the lima that
  colima already installs) through `tart run --net-fd`, with its SSH port
  forwarded to `127.0.0.1` only, as a managed Mac may drop the frames of
  tart's shared NAT (D-53, S8). A 30-line Python script (`net-fd.py`, run with
  the `python3` of the Xcode command line tools) passes the VM's socket to
  usernet, as Node cannot send a descriptor.

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
  be a `div` because it holds one text node per terminal row (D-22).
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
                "noExcessiveLinesPerFunction": {
                    "level": "warn",
                    "options": { "maxLines": 50, "skipBlankLines": true }
                },
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
- `.config/nextest.toml`: shows the output of the LaunchAgent tests even when they
  pass, so a run without a GUI login says that they checked nothing.
- `Cargo.toml`, under `[workspace.lints.clippy]`:
  `all = { level = "deny", priority = -1 }` and `cognitive_complexity = "deny"`.
  A justified exception uses
  `#[expect(clippy::cognitive_complexity, reason = "…")]`.

### 9.6 Testing

| Level                     | Tool                                                                                           | Covers                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| TypeScript unit           | Vitest 5 projects for main, connection host and shared code                                    | Reducers, framing, ssh arguments, parsers                                      |
| Renderer components       | Vitest browser mode (`@vitest/browser-playwright`, Chromium) + vitest-browser-react + axe-core | Keyboard behavior, ARIA, WCAG rules for each component state                   |
| Protocol contract         | Shared golden fixtures, checked by Rust tests and Vitest                                       | Compatibility of versions N and N−1 (NFR-12)                                   |
| Rust unit and integration | cargo-nextest 0.9; on Linux, the musl test binaries as root in containers (`pnpm test:daemon`) | Holder, core, bridge, persistence, bootstrap; Linux-only and other-user checks |
| Daemon over real SSH      | Vitest integration project with `sshd` in a container on Linux CI                              | US-1.1–US-1.5 end to end; no listeners (SEC-01)                                |
| App end to end            | Playwright 1.65 `_electron` + `@axe-core/playwright` 4.14 + ARIA snapshots                     | User-story flows; WCAG 2.2 AA rules on every view; tree snapshots (PRD §11.2)  |
| OS accessibility tree     | `tools/ax-probe`: a Swift CLI reading `AXUIElement` attributes                                 | A11Y-04 and A11Y-06 attributes: selected text, ranges, caret, focus            |
| Screen readers            | Scripted manual passes per user story (PRD §11.3)                                              | Announcements, NFR-04 timing, everything automation cannot judge               |

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
    - `pre-commit` rejects staged `.claude/` paths and absolute home-directory
      paths, then runs Prettier, `biome check --write` and `cargo fmt` on staged
      files.
    - `pnpm install` installs the hooks into the repository's `.git/hooks`
      without touching a global `core.hooksPath`, whose hook manager then runs
      them.
    - `commit-msg` runs commitlint 21 with `@commitlint/config-conventional`,
      which enforces the commit rules in CLAUDE.md.
- **No agent or editor configuration in git.** `.claude/` and other
  machine-specific files are git-ignored; lefthook is the only formatting hook.
- **Agent context.** CLAUDE.md lists the build, lint and single-test commands
  once the tooling lands.

### 9.8 CI on GitHub Actions (D-11)

| Runner                             | From | Jobs                                                           |
| ---------------------------------- | ---- | -------------------------------------------------------------- |
| `macos-15` / `macos-26` (arm64)    | E1   | App build, signing, notarization, end-to-end tests             |
| `macos-15-intel`                   | E1   | x64 smoke test                                                 |
| `ubuntu-24.04`, `ubuntu-24.04-arm` | E1   | Daemon musl builds and tests, sshd integration, renderer tests |
| `macos-15` / `macos-26` (arm64)    | E4   | Daemon universal2 build and tests                              |
| `windows-2025`, `windows-11-arm`   | E6   | Windows app, ConPTY holder, Authenticode                       |

Caches: the pnpm store, Electron and electron-builder downloads, Playwright's
Chromium, and Cargo.

## 10. Adoption by epic

| Epic | What the epic adds to the stack                                                                                                                                                                                                                                                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1   | §4.1–§4.4; macOS packaging, ad-hoc signed, and manual downloads (§4.5, D-17); the protocol (§6) with backpressure flow control instead of skip-to-latest (D-19); SSH and bootstrap (§7); POSIX shell profiles (§8); `trcd core`, `bridge` and `holder` on Linux musl, the core started detached by the bridge, without kill-scope isolation (D-20); all tooling (§9) |
| E2   | Holders outside the kill scope and the Linux service-mode rule (§5.4, D-44); upgrades in place (D-46); protocol 2 with reconnect from an offset and skip-to-latest flow control (D-04) with `Resync` and rebuild (D-45); automatic reconnect and restore at launch; soak tests (NFR-11)                                                                              |
| E3   | Persistence and restore (§5.5, D-48); history at program exit (D-49); protocol 3; daemon management                                                                                                                                                                                                                                                                  |
| E4   | macOS `trcd` (universal2, a plain LaunchAgent, D-50); the local bridge in the shared root (D-51); detached core on remote Macs; tart test hosts (D-52)                                                                                                                                                                                                               |
| E5   | Shell-integration scripts (§8, D-55); marks in the VT stream (D-56); protocol 4 semantic events and OS notifications (§6, D-57); bash and zsh in the three test images, fish in Ubuntu's and Alpine's                                                                                                                                                                |
| E6   | Windows: ConPTY holders, named pipes, Windows profile detection, Windows helpers in `trcd`, installer                                                                                                                                                                                                                                                                |
| E7   | Linux desktop: AppImage, local systemd daemon, AT-detection fallback (R3)                                                                                                                                                                                                                                                                                            |
| E8   | 1.0.0: Developer ID signing and notarization, Authenticode and Linux package signing (US-8.3); build provenance (US-8.2); signed checksums (US-8.4); the downloads site (US-8.1); Electron's built-in updater on macOS and the Windows and Linux updaters (US-8.5, D-43)                                                                                             |

## 11. Spikes

Results: [S1](spikes/S1.md), [S2](spikes/S2.md), [S3a](spikes/S3.md), [S4](spikes/S4.md), [S5](spikes/S5.md),
[S6](verification/E2-nfr.md#soak-nfr-11-s6), [S7](spikes/S7.md), [S11](spikes/S11.md), [S12](spikes/S12.md),
[S14](spikes/S14.md).

| ID  | Epic | Spike                                                                                                                                                                                                                               | Retires                      |
| --- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| S1  | E1   | libghostty-vt in Rust on musl x86_64/arm64: size, PSS per holder, VT round trip into xterm.js, matching grapheme widths and cursor columns, query replies                                                                           | D-02, US-1.11, NFR-09        |
| S2  | E1   | ATS selection and caret: every macOS attribute through the AX probe; Speak Selection, VoiceOver's read-selection command, Look Up, Services, Zoom caret tracking, dictation and IME                                                 | R1, A11Y-09                  |
| S3  | E1   | Floods and churn with VoiceOver on: `yes`, a 1 GB `cat`, `tree /` at 100 ms RTT; tune the credit window, page size, cadence and selection cap; echo suppression                                                                     | R2, R9, NFR-03, NFR-04       |
| S4  | E1   | `KnownHostsCommand` and `SSH_ASKPASS` behavior; the stderr message corpus for US-1.3; agent discovery for GUI launches                                                                                                              | US-1.2, US-1.3               |
| S5  | E1   | Bootstrap on Alpine/busybox, Ubuntu and RHEL; noexec home directories; LDAP users                                                                                                                                                   | R10                          |
| S6  | E2   | A 1,000-cycle soak of daemon kill and upgrade, with and without lingering, and across logout                                                                                                                                        | R4, R5, R6 (Linux), NFR-11   |
| S11 | E2   | systemd in a container: a transient-unit core with `Restart=on-failure`, holders in transient scopes, lingering and `KillUserProcesses` detection, what survives logout                                                             | R4, R5, R6 (Linux)           |
| S12 | E2   | Streaming a snapshot in blocks of rows through the formatter selection and tracked grid references while output arrives                                                                                                             | NFR-09                       |
| S13 | E2   | The renderer to connection-host message path on a sub-millisecond link ([results](spikes/S13.md), D-47)                                                                                                                             | NFR-02                       |
| S7  | E3   | Consistency of the persistence logs after a power cut                                                                                                                                                                               | NFR-08                       |
| S8  | E4   | Done ([S8](spikes/S8.md)): `setsid` + `AbandonProcessGroup`; LaunchAgent registration with `launchctl`; detached core on remote Macs                                                                                                | R4, R5, R7 (macOS)           |
| S14 | E5   | Shell-integration injection in bash 3.2 to 5, zsh and fish 3 and 4 on every host OS; marks through snapshots and restore; OS notifications from an ad-hoc-signed app; what makes macOS ask for `trcd`'s access to protected folders | US-5.1, US-5.2, US-5.3       |
| S9  | E6   | ConPTY holder outside the app's job object; libghostty-vt on MSVC; re-verify the ATS with JAWS, NVDA and Narrator                                                                                                                   | R1, R2, R4, R5, R8 (Windows) |
| S10 | E7   | Chromium AT detection and Orca on Wayland and X11; re-verify the ATS                                                                                                                                                                | R1, R2, R3 (Linux)           |

## 12. Decision log

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Why                                                                                                                                                                                                                                                                                | PRD effect                                                                                                               |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| D-01 | Rust daemon                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Footprint, static binaries, ConPTY, memory safety (§2)                                                                                                                                                                                                                             | Resolves OQ-2                                                                                                            |
| D-02 | libghostty-vt in the daemon; alacritty_terminal if it proves incompatible on a target OS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Grapheme fidelity, VT formatter, small cells; confirmed for Linux and macOS by S1                                                                                                                                                                                                  | —                                                                                                                        |
| D-03 | JSON control messages with ts-rs types; raw I/O frames                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Fewest tools; NFR-12 met through the handshake and fixtures                                                                                                                                                                                                                        | —                                                                                                                        |
| D-04 | Lagging clients skip to the latest screen; programs never block                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | NFR-03 and fair sharing (US-2.6); gaps are backfilled from the daemon                                                                                                                                                                                                              | —                                                                                                                        |
| D-05 | No encryption at rest; user-only permissions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | SEC-05 as written; remote hosts have no keychain the daemon can reach                                                                                                                                                                                                              | Resolves OQ-1                                                                                                            |
| D-06 | Manual downloads until 1.0.0; Electron's built-in updater on macOS with E8 (D-43)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Simplest start. electron-updater's macOS path opens a loopback listener (SEC-01)                                                                                                                                                                                                   | Resolves OQ-3; adds US-8.5 (an E3 story before D-43)                                                                     |
| D-07 | Review mode is a paged, read-only text field with caret navigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | A single element holding the whole buffer froze NVDA; matches VS Code                                                                                                                                                                                                              | Rewords A11Y-03.2                                                                                                        |
| D-08 | OS-visible selection is capped; copy is always exact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Chromium can't hold 100k selectable lines                                                                                                                                                                                                                                          | Adds A11Y-04.7                                                                                                           |
| D-09 | No telemetry and no crash reporting                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | SEC-08; nothing in the PRD needs them                                                                                                                                                                                                                                              | Resolves OQ-4                                                                                                            |
| D-10 | pnpm 12 workspaces; no task runner                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Strict, fast, supply-chain settings                                                                                                                                                                                                                                                | —                                                                                                                        |
| D-11 | GitHub for code, Actions for CI, Releases for downloads and the update feed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Hosted runners for every target OS and architecture                                                                                                                                                                                                                                | —                                                                                                                        |
| D-12 | React 19 + React Aria Components                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Accessible primitives; works with TypeScript 7; well supported by AI assistants                                                                                                                                                                                                    | —                                                                                                                        |
| D-13 | Biome is the only linter; no ESLint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | typescript-eslint caps TypeScript below 6.1; jsx-a11y doesn't support ESLint 10                                                                                                                                                                                                    | —                                                                                                                        |
| D-14 | libghostty-vt source comes from its signed release tarballs, checked against a SHA-256 manifest and the minisign key; build.rs never touches the network                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Reproducible, offline builds; no unverified download (SEC-04)                                                                                                                                                                                                                      | —                                                                                                                        |
| D-15 | Linux test hosts are sshd containers on a dedicated colima profile `trc`, ports on `127.0.0.1` only, keys generated per run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Real OpenSSH on Ubuntu, Alpine and Rocky without touching other profiles or exposing ports                                                                                                                                                                                         | —                                                                                                                        |
| D-16 | CI builds and unit-tests every push to `main` and every pull request on Ubuntu (app and daemon jobs, actions pinned by SHA); local `pnpm check`, integration and e2e suites remain the gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | The owner asked for CI with a status badge at M1; the e2e and AX suites need local test hosts and permissions                                                                                                                                                                      | —                                                                                                                        |
| D-17 | 0.x builds are ad-hoc signed (`codesign -s -`) and not notarized                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | No Developer ID identity yet; Apple silicon and the fuse flip need a signature                                                                                                                                                                                                     | Pre-1.0 exception to SEC-04.1, until 1.0.0 (D-43)                                                                        |
| D-18 | Test builds read `TRC_TEST_SSH_CONFIG` and `TRC_TEST_KNOWN_HOSTS` ahead of the user's ssh config and known_hosts, never in their place; a build-time define removes the seam from release builds, and an artifact test checks it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | OpenSSH reads `~/.ssh` from the passwd home, so tests need their own config                                                                                                                                                                                                        | —                                                                                                                        |
| D-19 | E1 flow control is backpressure: the holder pauses PTY reads when its single client runs out of credit. D-04 applies from E2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | E1 has one client per session; no line is skipped, so A11Y-02.3 and A11Y-03 need no backfill                                                                                                                                                                                       | —                                                                                                                        |
| D-20 | In E1, `trcd bridge` starts the core detached (double fork, `setsid`, under a lock) when its socket is absent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Service-manager registration and kill-scope isolation arrive with E2 (US-2.4, US-2.5)                                                                                                                                                                                              | —                                                                                                                        |
| D-21 | ssh also gets a generated wrapper config (`-F`) that sets the security options first and includes the user's and the system config                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `ProxyJump` connections receive none of the `-o` options (S4)                                                                                                                                                                                                                      | —                                                                                                                        |
| D-22 | The ATS takes input as a `contenteditable` element that cancels every edit, not through EditContext                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | EditContext broke caret bounds for macOS Zoom (S2, A11Y-06.3)                                                                                                                                                                                                                      | —                                                                                                                        |
| D-23 | The holder opens PTYs and spawns shells itself on rustix, not through portable-pty                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | portable-pty allocates between fork and exec, which crashed or hung concurrent spawns on musl (ST-5)                                                                                                                                                                               | —                                                                                                                        |
| D-24 | The app embeds its fonts: Atkinson Hyperlegible Next (UI) and Intel One Mono (terminal), both variable, OFL 1.1, at a 14 px base size, loaded before the terminal opens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Legibility for low-vision users, and the same metrics on every machine; xterm.js measures the cell when it opens                                                                                                                                                                   | System fonts                                                                                                             |
| D-25 | Midnight, from the A11y Matrix Dark VS Code theme, is the default theme; "Match System" follows the OS among the other four (PRD A11Y-07.3). Each theme has separate UI and terminal palettes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Owner's choice; AAA contrast. Its selection is white on #006b24 (3.1:1 against black, A11Y-04's 3:1), never inverted, and its cursor a block in the border green                                                                                                                   | Following the OS by default                                                                                              |
| D-26 | `@xterm/addon-webgl` 0.19.0 is patched (`patches/`) so its glyph font string starts with `normal`, not a space                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Electron 45's Chromium rejects a canvas font string with a leading space, so every glyph was drawn in 10px sans-serif. Drop the patch when upstream fixes it                                                                                                                       | The DOM renderer                                                                                                         |
| D-27 | Test builds open unseen when `TRC_TEST_BACKGROUND=1`: accessory activation policy, `showInactive`, windows fully transparent (opacity 0), click-through and in the bottom-right corner of the work area (owner, 2026-11-15); every e2e, NFR and soak launch sets it. Playwright's input goes to the page, and transparent windows still draw. AX tests still take focus                                                                                                                                                                                                                                                                                                                                                                                  | Automated runs must not take the developer's focus or show over their work; macOS reports the focused element only for the active app                                                                                                                                              | —                                                                                                                        |
| D-28 | Terminal output posts with a leading-edge 5 ms throttle, and the ATS updates the echo of typing on the next frame even while AT runs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Measured: the trailing 5 ms batch added about 2 ms to every echo, and the 250 ms AT cadence left half the keystrokes waiting 100 ms or more (M1 latency review)                                                                                                                    | A trailing batch; one cadence                                                                                            |
| D-29 | The app closes a session whose process exits with code 0, when the exit event arrives or when it lists sessions after a reconnect; other exits stay until closed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Owner's choice (PRD v0.7, US-1.10.7). The app holds the auto-close setting (ST-18), so it closes through the daemon's `close` request                                                                                                                                              | The daemon closing them                                                                                                  |
| D-30 | The renderer honors the kitty keyboard protocol's disambiguate level: it follows the flags programs push, pop and set per screen, and the key encoder then sends Escape, modified Enter, Tab and Backspace, and Ctrl or Alt keys as `CSI u`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | The daemon's libghostty-vt answers the flags query, so programs such as Claude Code turn the protocol on; with legacy keys Shift+Enter read as Enter. Other flag bits and reattach state are not carried yet                                                                       | Stop answering the query                                                                                                 |
| D-31 | The logo is drawn by code (`tools/icons`, `pnpm icons`): an SVG master and a simplified one for 48 px and below, rendered with Playwright's Chromium; `.icns` comes from macOS `iconutil` and `.ico` is packed in-house                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Reproducible icons from one source, with no new dependency or design tool                                                                                                                                                                                                          | A drawing tool, ImageMagick                                                                                              |
| D-32 | The renderer sets xterm.js's private `coreService.isCursorInitialized` once the terminal opens (`terminal/xterm-cursor.ts`), the one use of xterm.js internals                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | xterm.js draws no cursor until its hidden textarea has had focus, and the ATS takes all focus, so the cursor never showed; a pixel test fails if an upgrade moves the flag                                                                                                         | Focusing the textarea, which would move AT focus                                                                         |
| D-33 | The app keeps `config.json` and `hosts.json` in the TRC home, `~/.trc` or `TRC_HOME` (a leading `~` is the home folder); hosts install the daemon to `~/.trc` without asking, a host's actions move it for a home that cannot run programs (US-1.4.3, ST-12), and test builds take `TRC_TEST_INSTALL_ROOT`                                                                                                                                                                                                                                                                                                                                                                                                                                               | Owner's choice: one folder the user can find, back up and point elsewhere; the install location is no longer asked                                                                                                                                                                 | `userData` (P-18 as first written)                                                                                       |
| D-34 | Releases follow semver from `v*` tags: `pnpm release <major\|minor\|patch>` sets every manifest's version and commits it, builds the daemons and the ad-hoc signed arm64 and x64 dmg and zip from that commit with electron-builder 26 (fuses per §4.5, main bundled with its dependencies), tags, pushes and publishes a GitHub Release titled `TRC v<version>` with notes and SHA-256 sums, then moves `main` to `<next minor>-dev`. Superseded in its mechanism by D-42: the same steps now run in GitHub Actions                                                                                                                                                                                                                                     | Owner's choice (M1): GitHub Releases as the foundation; a `-dev` daemon never counts as newer, so development and release builds share hosts                                                                                                                                       | CI-built artifacts                                                                                                       |
| D-35 | The app names itself everywhere macOS shows it: the menus and the About panel come from the package's `productName`, and the About panel shows the version, the build's git commit (`-dirty` for a changed tree, defined at build time), the copyright and the repository. A root `postinstall` brands the development Electron.app (name, icon, ad-hoc re-signature) so `electron .` and the tests show the product too                                                                                                                                                                                                                                                                                                                                 | Owner's request (M1): the right name, logo and version in the OS menus and About                                                                                                                                                                                                   | Renaming the dev bundle's executable, which would break the `electron` package's path                                    |
| D-36 | The renderer matches every app shortcut against one keymap (`src/shared/keymap.ts`, `docs/design/keymap.md`) before the focused element sees the key; menus, the palette and the keyboard run the same commands, and the macOS menus show only Command shortcuts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Send-next-key (A11Y-05.3) must pass any app shortcut to the process, which a native menu accelerator would swallow first; Command chords never reach the process anyway                                                                                                            | Menu accelerators for every shortcut                                                                                     |
| D-37 | Spoken output reads xterm.js's buffer once output settles: the logical lines since a marker at the cursor's line, without the shell echo of typed text, floods over 20 lines a second summarized after a 500 ms pause, and the cursor line in the alternate screen. Screen-reader mode follows Chromium's accessibility support unless `config.json` or `--screen-reader-mode` forces it                                                                                                                                                                                                                                                                                                                                                                 | Reading the final buffer collapses redraws and overwrites to the final text (A11Y-02.2) with one code path for every screen reader; xterm.js's own screen-reader mode speaks each printed character and adds a second accessibility tree beside the ATS                            | xterm.js `screenReaderMode`; announcing each write as it arrives                                                         |
| D-38 | Links of any scheme open with the OS, always behind a confirmation that shows the full target, unless the target starts with a trusted prefix in `accept_urls.json` in the TRC home; the confirmation can trust a link's `scheme://host`, and a prefix matches only up to `/`, `?` or `#`. Test builds write opened links to `TRC_TEST_OPENED_LINKS` instead (P-14)                                                                                                                                                                                                                                                                                                                                                                                      | Owner's choice (2026-11-13): every scheme the OS handles, with a dialog and an allow list; Electron warns that `shell.openExternal` with untrusted text can run local handlers, so nothing opens without the user's click and either the confirmation or a prefix the user trusted | http and https only; opening at once when the text is the target                                                         |
| D-39 | pnpm patches on `@xterm/xterm` 6.0.0 and `@xterm/addon-webgl` 0.19.0 hold dim (SGR 2) text to the full minimum contrast ratio in both renderers; `tools/xterm-patches` checks the installed bundles                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | xterm.js divides the floor by 2 for dim cells, which fails A11Y-07's 4.5:1; there is no option for it                                                                                                                                                                              | Dropping SGR 2 in a parser hook, which loses dim text's look entirely; waiting for an upstream option                    |
| D-40 | Review mode is a read-only `<textarea>` laid over the terminal, holding 500 logical lines around its caret, rather than the ATS in read-only mode                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | A native text field gives every screen reader, braille routing, selection and copy without custom code, and keeps the ATS one job: the live grid                                                                                                                                   | The ATS `contenteditable` in read-only mode                                                                              |
| D-41 | The in-app user guide is `USER_GUIDE.md` rendered to `resources/docs/index.html` by a small in-repo converter (`tools/user-docs`, `pnpm docs:guide`) for the Markdown the guide uses; a test fails while the committed page is stale. The Help menu opens it in a sandboxed window with no preload, served from its own `app://docs` host with a script-free CSP                                                                                                                                                                                                                                                                                                                                                                                         | One source for the repository's guide and the app's, so they never drift (A11Y-10.4, P-18); the page has headings, lists and tables, a `main` landmark and the guide's language                                                                                                    | None; serves A11Y-10.4 and keeps SEC-01 (no scripts, no network)                                                         |
| D-42 | Releases run entirely in GitHub Actions (`.github/workflows/release.yml`), started by hand with a bump level and an optional dry run: a prepare job commits the version as `github-actions[bot]`, `ci.yml` runs as a reusable workflow on that commit, `macos-15` builds both musl daemons and the universal macOS one (D-54), `macos-15` packages the arm64 and x64 dmg and zip with them, `macos-15` and `macos-15-intel` run the release-artifact checks on their own architecture, and only then a publish job (the only one with `contents: write`) tags, pushes `main` and the tag atomically, publishes `TRC v<version>` with notes and SHA-256 sums, and moves `main` to the next `-dev` version. `pnpm release` starts and watches the workflow | Owner's choice (2026-11-13): builds from a clean runner, both architectures smoke-tested natively, nothing pushed or published until every job passes                                                                                                                              | Tag pushed locally with CI publishing; CI building a draft the owner publishes; building on the owner's Mac (D-34)       |
| D-43 | 0.x releases are alpha, experimental builds, not an official release; 1.0.0 is the first official release. Automatic updates move from E3 to E8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Owner's choice (2026-11-13). Squirrel.Mac installs only updates whose Developer ID signature matches the running app, and Developer ID signing arrives with E8; alternatives were signing in E3, or draft-only releases until signing exists                                       | SEC-04.1's exception ends with 1.0.0; E3's update story becomes US-8.5; §9, OQ-3 and the §11.5 E1 note follow            |
| D-44 | Linux service mode uses systemd only as the host has it: a transient user unit for the core and transient scopes for holders when lingering is on, or when logind ends user processes at logout; otherwise detached. The app never enables lingering and writes nothing outside the install root                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Owner's choice (2026-11-13): no host settings changed. Alternatives were enabling lingering (a persistent change for the account), asking per host, or never using systemd                                                                                                         | US-2.4 and §5.4 follow; R6 keeps its mitigation                                                                          |
| D-45 | A client that skipped output during a flood is rebuilt from the daemon's whole scrollback and screen, streamed, once output pauses and before review mode or find opens; `ReadRows` is dropped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Owner's choice (2026-11-13). xterm.js cannot insert rows into the middle of its buffer; alternatives were backpressure while one client is attached, or fetching rows for review mode and find only                                                                                | A11Y-02.3 and A11Y-03 keep every line                                                                                    |
| D-46 | The app upgrades a host's daemon in place on connect when it bundles a newer one: the new bridge stops an older core and starts its own, which adopts every holder; holders are never upgraded. A newer installed daemon is used when the protocol overlaps; only `Incompatible` asks for an app update                                                                                                                                                                                                                                                                                                                                                                                                                                                  | US-2.5.3 and NFR-12: sessions never end, and two Macs with different app versions share a host                                                                                                                                                                                     | US-1.4.6 applies to protocol incompatibility only                                                                        |
| D-47 | The main process turns off Chromium's `DeferRendererTasksAfterInput` (`--disable-features`) before the app is ready                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | S13: after a key press the feature held the echo's output message until the next frame, up to 10 ms on a 100 Hz display; without it the app adds about 5 ms at p95 on a 1 ms link (NFR-02)                                                                                         | Accepting E1's 15 ms local allowance; moving output to a worker, whose posts to the main thread wait the same way        |
| D-48 | A starting core restores every session whose processes ended while it ran, unless the user stopped or closed it or turned its restore off; nothing registers the daemon to start at boot, so a host's sessions come back when the app next connects                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | The owner keeps D-44's rule that the app writes nothing outside the install root (P-39); a reboot, a logout that ends user processes and a killed holder lose the same work, and come back the same way (P-40)                                                                     | A persistent systemd user unit in `~/.config/systemd/user`; restoring only after a boot ID change                        |
| D-49 | A client that attaches while a full-screen program runs gets that screen, and the shell's history and screen, streamed, when the program leaves the alternate screen; the holder keeps no copy of the primary screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | libghostty-vt formats only the active screen, and the app reads only the active buffer, so nothing it shows waits; this ends NFR-09's E2 exception for every session, including those that save nothing to disk (P-47)                                                             | Streaming the history from the on-disk log, which leaves the copy for sessions that do not save scrollback (P-37's plan) |
| D-50 | On macOS the core is a plain per-user LaunchAgent: a plist in `~/Library/LaunchAgents` labelled `dev.trc.trcd-<hash8>` that runs the installed binary, loaded with `launchctl bootstrap gui/<uid>`, with `RunAtLoad`, `KeepAlive` after any unsuccessful exit, a 1 s `ThrottleInterval` and `AbandonProcessGroup`; remote Macs register it only with a GUI login session, else run detached                                                                                                                                                                                                                                                                                                                                                              | No administrator, and it works on 0.x's ad-hoc signed builds; SMAppService needs signing and notarization (E8)                                                                                                                                                                     | US-4.1, US-4.3, US-4.4, US-4.5.2 (E4 plan P-55, P-60, P-61)                                                              |
| D-51 | The Mac's own daemon uses the default install root `~/.trc`, beside the app's files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | One daemon per user serves the Mac's sessions and every computer that adds the Mac as a host                                                                                                                                                                                       | US-4.5.3 (E4 plan P-56)                                                                                                  |
| D-52 | macOS test hosts are local tart VMs, deleted after every run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Real macOS over SSH without touching the owner's Mac (no Remote Login on it)                                                                                                                                                                                                       | — (E4 plan P-57)                                                                                                         |
| D-53 | The macOS test VM's network is lima's user-mode network (`limactl usernet`) through `tart run --net-fd`, with SSH forwarded to `127.0.0.1` only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Tart's shared NAT got no DHCP lease on the owner's managed Mac: the VM's frames never reached the host bridge (S8). The user-mode network needs no root and exposes nothing beyond loopback                                                                                        | Bridged networking (puts the VM on the LAN); softnet (needs a setuid root binary)                                        |
| D-54 | The macOS daemon is one universal2 binary, `cargo build` for both Apple targets joined by `lipo` and ad-hoc signed, with macOS 13.0 as the deployment target for Rust and libghostty-vt alike; the release builds every daemon on `macos-15`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | PRD §7.2 asks for the current and previous two macOS releases; one binary serves arm64 and x86_64 Macs, locally and over SSH                                                                                                                                                       | Two thin binaries picked by `uname -m`; cargo-zigbuild for Apple targets (needs the macOS SDK)                           |
| D-55 | Shell integration is injected by the holder at every shell start: bash 4+ with `--posix` and `ENV`, macOS bash 3.2 with a non-login `--rcfile`, zsh with a `ZDOTDIR` `.zshenv`, fish with `XDG_DATA_DIRS`; the scripts are TRC's own, embedded in `trcd` and written to the 0700 root                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | A login shell stays one (bash ignores `--rcfile` when it is a login shell); no dotfile changes (US-5.1.1); one mechanism on every host                                                                                                                                             | US-5.1 (E5 plan P-73)                                                                                                    |
| D-56 | Command marks travel as OSC 133 in the VT stream: the holder tracks each command's prompt row, exit status and times, and writes the marks back into snapshots and saved history                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | The formatter drops OSC 133, so without this a reattach or a restore loses every mark; one representation keeps the app's parsing single                                                                                                                                           | US-5.2 (E5 plan P-74)                                                                                                    |
| D-57 | Protocol 4: the core broadcasts `Bell` and `CommandFinished` events and `integration` to every protocol 4 client instead of `events` attachments; the main process posts OS notifications with Electron's `Notification`, holding the session name, host and event only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Background events for sessions never opened, at no output cost (NFR-05); a sandboxed renderer cannot post notifications, and output must never reach the lock screen                                                                                                               | US-5.3 (E5 plan P-75, P-76)                                                                                              |

## 13. Versions (verified 2026-11-11)

**App and tooling (npm).**

| Package                        | Version | Package                                                  | Version                |
| ------------------------------ | ------- | -------------------------------------------------------- | ---------------------- |
| electron                       | 45.3.1  | @xterm/xterm                                             | 6.0.0                  |
| typescript                     | 7.0.2   | @xterm/addon-webgl                                       | 0.19.0                 |
| @types/node                    | ~24     | @xterm/addon-unicode-graphemes                           | 0.4.0                  |
| vite                           | 8.3.8   | @xterm/addon-search                                      | 0.16.0                 |
| electron-vite                  | 6.0.0   | Atkinson Hyperlegible Next, Intel One Mono (fonts, D-24) | google/fonts `f2bd09b` |
| electron-builder               | 26.18.0 | react, react-dom                                         | 19.3.1                 |
| @electron/fuses (CI check)     | 2.1.3   | react-aria-components                                    | 1.22.1                 |
| pnpm                           | 12.18.0 | @vitejs/plugin-react                                     | 6.3.0                  |
| @biomejs/biome                 | 2.6.7   | zustand                                                  | 5.1.0                  |
| prettier                       | 3.10.0  | react-intl                                               | 12.1.7                 |
| vitest                         | 5.1.0   | @formatjs/cli                                            | 6.18.2                 |
| @vitest/browser-playwright     | 5.1.0   | zod                                                      | 4.6.7                  |
| vitest-browser-react           | 2.3.0   | colorjs.io (dev)                                         | 0.7.1                  |
| @playwright/test               | 1.65.0  | lefthook                                                 | 2.2.2                  |
| axe-core, @axe-core/playwright | 4.14.0  | @commitlint/cli, config-conventional                     | 21.2.4                 |
| @types/react, @types/react-dom | 19.3.0  | playwright (Vitest browser provider)                     | 1.65.0                 |
| @xterm/headless (replay test)  | 6.0.0   |                                                          |                        |

**Daemon (crates.io and toolchains).**

| Crate or tool                      | Version | Crate or tool      | Version           |
| ---------------------------------- | ------- | ------------------ | ----------------- |
| Rust                               | 1.99.1  | serde / serde_json | 1.0.229 / 1.0.154 |
| Zig (build only)                   | 0.17.1  | ts-rs              | 12.0.1            |
| minisign (dev only)                | 0.12    | colima (dev only)  | 0.10.3            |
| docker CLI (dev only)              | 29.8.1  | tart (dev only)    | 2.42.0            |
| cargo-zigbuild                     | 0.24.1  | sha2               | 0.11.1            |
| libghostty-vt                      | 1.0.1   | libc (macOS only)  | 0.2.191           |
| lima, `limactl usernet` (dev only) | 2.2.0   |                    |                   |
| alacritty_terminal (fallback)      | 0.26.0  | tracing            | 0.1.44            |
| tokio                              | 1.54.1  | tracing-subscriber | 0.3.23            |
| tokio-util                         | 0.7.20  | tracing-appender   | 0.2.5             |
| rustix                             | 1.1.6   | thiserror          | 2.0.21            |
| windows-sys (E6)                   | 0.61.2  | bindgen (one-off)  | 0.73.2            |
|                                    |         | cargo-nextest      | 0.9.151           |

## 14. Not used, and why

| Rejected                                  | Reason                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| node-pty, napi-rs, any native Node module | PTYs live in the daemon; the app needs only Node built-ins                                         |
| xterm.js screen reader mode               | Its custom selection is invisible to the OS; its announcements are assertive and duplicated        |
| electron-updater                          | Its macOS updater serves the update over a loopback HTTP server (SEC-01)                           |
| `crashReporter`, Sentry, telemetry        | SEC-08; not required by the PRD                                                                    |
| ESLint, typescript-eslint, TypeScript 6   | Incompatible with TypeScript 7 and ESLint 10; Biome covers lint and a11y rules                     |
| React Compiler                            | Experimental, needs an extra native package; not needed for the PRD                                |
| Svelte, Vue, Lit, Solid                   | TypeScript 7 template checks (Svelte, Vue); shadow DOM breaks ARIA (Lit); Solid 2.0 not yet stable |
| Tailwind, CSS-in-JS, vanilla-extract      | CSS Modules and custom properties are enough                                                       |
| Protobuf, ConnectRPC, gRPC, Cap'n Proto   | More tooling than the protocol needs (§6)                                                          |
| ssh2, russh                               | They don't read `ssh_config` or support the user's full key setup                                  |
| SQLite                                    | Needs a C build; nothing is queried                                                                |
| Turborepo, Nx, Bun                        | One app and one daemon need no task graph and no second runtime                                    |
| Storybook                                 | A second build; its a11y run can skip silently                                                     |
| Guidepup screen-reader automation         | Pre-1.0, needs a dedicated Mac for VoiceOver; the PRD gates on scripted manual passes (§11.3)      |
| Electron Forge                            | Squirrel-only updates and more packages than electron-builder                                      |

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

# E6 bring-up: the project on Windows

Before the E6 plan, the owner asked for every default build and test flow to run on Windows, and for macOS-only
scripts to be split out (2026-11-20). This records what was run on Windows 11 Pro x64 (build 26300), what changed,
and what the E6 plan has to take over. Decisions: TECH_STACK D-59 to D-64.

## Results

| Flow                                    | Result on Windows | Notes                                                                                            |
| --------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| `pnpm install`                          | Passes            | Installs the hooks through `tools/git-hooks/install.ts`; fetches the dev Electron                |
| `pnpm check`                            | Passes            | 1,372 Vitest tests pass and 6 skip (POSIX-only features); 91 Rust tests pass natively            |
| `pnpm build`, `build:test`              | Passes            | The test build compiles the P-14 seam in; the production build does not                          |
| `pnpm --filter @trc/desktop dev`        | Passes            | The window opens and renders the workspace; no This computer (US-6.2)                            |
| `pnpm build:daemon`                     | Passes            | Linux x64 and arm64 through cargo-zigbuild; the x64 binary runs on Linux and reports its SHA-256 |
| `pnpm dist`                             | Passes            | `TRC-<version>-win-x64.zip`, fuses and asar integrity applied, unsigned; the packaged app opens  |
| libghostty-vt for `x86_64-windows-msvc` | Builds            | `trc-vt` and `ghostty-vt-sys` link it and pass their tests, golden corpus included               |
| `trcd` for Windows                      | Does not compile  | 114 errors: Unix sockets, rustix PTY, process and fs, Unix signals (US-6.2)                      |
| Live suites, `*:mac` scripts            | Not run           | Integration, e2e, NFR and soak need the test hosts; `*:mac` need macOS                           |

## Fixed on the way

- Saving any JSON state failed on Windows: `JsonStore` flushed its directory, which Windows refuses (`EPERM`). The
  app could not keep `config.json`, `hosts.json`, `sessions.json` or `accept_urls.json`.
- `electron-vite dev` failed with "Electron uninstall": Electron 45 downloads its binary on first use, and only the
  macOS branding step used it.
- `i18n:check`, `notices:check`, `prepare`, `gen:check`, `build:test`, `build:daemon` and `rust:check` relied on a
  POSIX shell or on `.bin` shims (D-60).
- The pre-commit guard missed Windows home paths (`C:\Users\<name>\`).
- `ghostty-vt-sys`'s build script required `HOME`, which Windows leaves unset outside Git Bash.

## For the E6 plan

1. The PRD's Windows read-aloud cell (§7.3) names Narrator only. The owner reads with Magnifier's read aloud: select
   text, Ctrl+Alt+Enter, and Ctrl+Alt+click to read from the pointer. Add it to the AT matrix and to A11Y-04 and
   A11Y-06 verification, or nothing requires it.
2. SSH (US-6.1): the connection host spawns `/usr/bin/ssh`; Windows needs `System32\OpenSSH\ssh.exe` and its agent.
   On the owner's machine Git's OpenSSH 8.8 comes first on PATH, so the absolute path matters. The `askpass` and
   `known-hosts` helpers are sh scripts that Windows OpenSSH cannot run. The tests that fake ssh with an sh script
   skip on Windows. The discarding known_hosts check (D-58) matches `/dev/null` and `none` only; find out what
   `ssh -G` reports on Windows when a config names `NUL` or `/dev/null`.
3. Privacy at rest (SEC-02, SEC-05): Windows has no POSIX modes; the TRC home relies on the profile's ACL. Decide
   whether the app sets a user-only DACL, and test it.
4. Copy (US-6.1, A11Y-04): xterm.js copies a selection with CRLF on Windows, while Copy last command output builds
   LF. Pick one convention.
5. Menus (A11Y-05): the menu bar opens with a macOS-style app menu named after the product; Windows expects
   File/Edit/View/Help, with Settings and Quit under File and About under Help.
6. The daemon (US-6.2, R4, R5): named pipe, ConPTY holders outside the core's job object, per-user auto-start. The
   emulator side already builds and passes on Windows.
7. Packaging (SEC-04, US-8.3): installer, Windows architectures (the PRD names none; arm64?), Authenticode. A Windows
   release also needs the macOS daemon, which only builds on macOS (D-61).
8. CI: a Windows Rust job needs Zig and minisign on the runner; the live suites need Windows test hosts, as
   `tools/test-hosts` is sh and colima.
9. `TRC_HOME` understands `~/` but not `~\`.
10. Saving state renames over the old file; on Windows, an antivirus or indexer holding it open can fail the rename.

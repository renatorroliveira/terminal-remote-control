# Terminal Remote Control — Product Requirements Document

| Field        | Value                                        |
| ------------ | -------------------------------------------- |
| Status       | Draft v0.7                                   |
| Owner        | Renato Oliveira                              |
| Last updated | 2026-11-12                                   |
| Scope        | P0 (first release), delivered in seven epics |
| Name         | Terminal Remote Control (TRC)                |

The keywords MUST, MUST NOT, SHOULD, SHOULD NOT and MAY follow
[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). Targets marked
"initial" are starting points that the design phase validates and may revise.

---

## 1. Summary

Terminal Remote Control is a desktop application for running and managing many
terminal sessions on the local computer and on remote hosts. A sidebar on the
left lists every session, grouped by host. The selected session's terminal fills
the center.

Sessions do not belong to the application. A per-user daemon on each host owns
them. The daemon starts, monitors, stops, restarts and restores the processes
that run in each terminal. The application only renders sessions and relays
input. Quitting or crashing the application ends no session. Losing the
network or rebooting the client computer ends no remote session. When a host
reboots, its daemon respawns each session's shell and restores its scrollback.
When the application opens again, it reattaches to every session on every host
automatically.

Remote hosts are reached over SSH with key-based authentication only. The
application never prompts for a password. On first connection it installs the
daemon on the remote host for the SSH user, starts it, and talks to it through
the SSH connection. No port is opened on any host.

**Accessibility is the number one requirement.** The terminal and all
surrounding UI MUST conform to WCAG 2.2 Level AA and integrate natively with the
accessibility services of macOS, Windows and Linux: VoiceOver, JAWS, NVDA,
Narrator, Orca, screen magnifiers, read-aloud features, and voice control and
dictation where the OS provides them. Terminal text is selectable, readable
aloud, reported to the operating system as selected text, and the operating
system can track keyboard focus and the text cursor. Accessibility and security
are global requirements ([§8](#8-global-requirements)): every epic meets them in
full for what it delivers, and a release that fails one does not ship.

P0 is delivered in seven incremental epics ([§9](#9-epics)). Each epic ships a
build that users can use for real. The first is an accessible macOS app
connected to Linux hosts. Later epics add sessions that outlive the app and the
network, recovery after a host reboot, command awareness, local sessions on the
Mac, and finally Windows and Linux desktop apps.

## 2. Problem

Developers who keep long-running work in terminals (builds, log tails, REPLs,
remote shells on cloud desktops) have two options today, and both fail
assistive-technology users:

1. **Desktop terminals** (macOS Terminal, Windows Terminal, the VS Code
   integrated terminal) end their shell processes when the application quits.
   Some recreate a fresh shell on relaunch, but the running work is gone. Remote
   shells die with the SSH connection or survive only for a remote server's
   grace period.
2. **Terminal multiplexers** (tmux, screen) keep sessions alive, but the user
   must install and configure them on every host and drive them with prefix-key
   commands. They draw status bars, pane borders and window lists as characters
   inside the terminal grid. A screen reader reads those redraws as text, and
   there is no OS-level selection, focus or structure.

No product combines persistent local and remote sessions, zero per-host setup,
and first-class assistive-technology support.

## 3. Goals

| ID  | Goal                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | **Accessible.** WCAG 2.2 AA plus native assistive-technology integration on macOS, Windows and Linux. Screen reader, magnifier, keyboard-only and voice-control users (where the OS provides voice control) complete every core task. |
| G2  | **Persistent.** Sessions survive app quit, app crash, daemon crash and daemon upgrade. Remote sessions also survive network loss and client reboot. After a host reboot, sessions respawn with their scrollback.                      |
| G3  | **Zero remote setup.** Any host the user can reach with `ssh` and a key works. No sudo, no package installs and no internet access are required on the host.                                                                          |
| G4  | **One place.** All sessions, local and remote, in one list with live state.                                                                                                                                                           |
| G5  | **Secure by default.** No network listeners, OS-enforced access control, and SSH as the only remote trust boundary.                                                                                                                   |

Non-goals for P0 are listed in [§12](#12-out-of-scope-for-p0).

## 4. Tenets

1. **Accessibility is the product, not a feature.** When a design choice trades
   accessibility for performance, visual polish or schedule, accessibility wins.
2. **Sessions outlive everything except the host.** Only a host reboot or logout
   ends a session's processes, and the daemon then respawns the session.
3. **SSH is the only door to a remote host.** We add no listener, no credential
   and no authentication scheme of our own.
4. **No privileges.** Everything installs and runs as the user. Nothing needs
   root or administrator rights.
5. **Never surprise the user with input.** We never replay keystrokes or
   re-run commands. After a disconnect or reboot, nothing runs that the user did
   not start.

## 5. Personas

| Persona    | Description                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sam**    | Blind developer. Uses JAWS or NVDA on Windows and VoiceOver on macOS, with a refreshable braille display. Keyboard only. Runs builds and log tails on cloud desktops for hours. |
| **Lee**    | Low-vision site reliability engineer. Uses macOS Zoom or Windows Magnifier at 400–800%, high-contrast themes, large fonts, and Speak Selection to read long output.             |
| **Alex**   | Developer with a repetitive strain injury. Uses the keyboard plus macOS Voice Control or Windows Voice Access, and dictation.                                                   |
| **Jordan** | Sighted power user. Keeps dozens of sessions across the local computer and ten or more remote hosts. Wants speed and sessions that never die.                                   |

## 6. Glossary

| Term               | Meaning                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Desktop app        | The Electron application the user sees.                                                                                        |
| Daemon             | The per-user background service on a host that owns sessions. The same daemon runs on the local computer and on remote hosts.  |
| Host               | A computer that runs a daemon: "This computer" or a remote host reached over SSH.                                              |
| Session            | A terminal: a pseudo-terminal (PTY on macOS/Linux, ConPTY on Windows), the process running in it, its scrollback and metadata. |
| Attach / detach    | A desktop app connecting to or disconnecting from a session. Detaching never affects the session.                              |
| Scrollback         | The retained output history of a session, kept by the daemon in memory and, from E3, on disk.                                  |
| Review mode        | A read-only, screen-reader-navigable text view of a session's scrollback and screen (see A11Y-03).                             |
| Shell integration  | Escape sequences (OSC 133 and compatible) that mark prompts, commands, output and exit status.                                 |
| AT                 | Assistive technology: screen readers, magnifiers, voice control, read-aloud tools, braille displays.                           |
| Global requirement | A requirement every epic MUST meet for everything it delivers ([§8](#8-global-requirements)). IDs: `A11Y-*`, `SEC-*`, `NFR-*`. |
| Epic               | An incremental deliverable users can use for real ([§9](#9-epics)). IDs: `E1`–`E7`.                                            |
| User story         | A customer-facing capability that is part of an epic's acceptance criteria. IDs: `US-<epic>.<n>`.                              |

## 7. Platform support

### 7.1 Desktop app

| OS      | Versions                                                                      | Notes                                                                       |
| ------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| macOS   | Current and previous major release; Apple silicon and Intel                   | Local shells: the user's login shell.                                       |
| Windows | Windows 11, all versions under Microsoft support                              | Local shells: PowerShell 7, Windows PowerShell 5.1, cmd, WSL distributions. |
| Linux   | Ubuntu LTS (current and previous), Fedora (current); GNOME on Wayland and X11 | Local shells: the user's login shell.                                       |

### 7.2 Remote hosts

| OS    | Architectures | Notes                                                |
| ----- | ------------- | ---------------------------------------------------- |
| Linux | x86_64, arm64 | glibc and musl distributions. No packages installed. |
| macOS | arm64, x86_64 | Current and previous two major releases.             |

Remote host prerequisites: an OpenSSH server that accepts public-key
authentication for the user, a POSIX `sh`, standard base utilities, and a
writable install location that permits execution (the home directory by
default, configurable per host). Root access, package installs and outbound
internet access are not required.

### 7.3 Assistive technology matrix (P0)

Every global accessibility requirement MUST pass on every applicable cell of
this matrix, for each desktop platform an epic delivers (§7.4). A cell marked
"—" means the OS provides no such assistive technology; it is not a release
gate. "Current and previous" means the current and previous major release of the
AT.

| Capability               | macOS                                                                                         | Windows                                                  | Linux                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------- |
| Platform API             | NSAccessibility                                                                               | UI Automation; MSAA / IAccessible2                       | AT-SPI2                                                 |
| Screen readers           | VoiceOver                                                                                     | JAWS, NVDA (current and previous); Narrator              | Orca                                                    |
| Braille                  | VoiceOver braille                                                                             | JAWS and NVDA braille                                    | Orca braille (BRLTTY)                                   |
| Magnifier                | Zoom                                                                                          | Magnifier                                                | GNOME Magnifier                                         |
| Voice control, dictation | Voice Control, Dictation                                                                      | Voice Access, Voice Typing                               | — (no OS-provided voice control; not gated)             |
| Read aloud               | Spoken Content: Speak Selection, Speak items under the pointer                                | Narrator                                                 | Orca                                                    |
| Keyboard access          | Full Keyboard Access                                                                          | Standard keyboard navigation                             | Standard keyboard navigation                            |
| Display preferences      | Dark mode, Increase Contrast, Reduce Motion, Reduce Transparency, Differentiate Without Color | Dark mode, Contrast themes, Animation effects, Text size | Dark style, High Contrast, Reduce Animation, Large Text |

Dragon (Windows) and macOS Switch Control SHOULD work. They are not release gates
for P0.

### 7.4 Platform delivery order

| Order | Platform                                                       | First delivered in |
| ----- | -------------------------------------------------------------- | ------------------ |
| 1     | macOS desktop app                                              | E1                 |
| 2     | Linux remote daemon                                            | E1                 |
| 3     | macOS daemon: local sessions on the Mac and macOS remote hosts | E5                 |
| 4     | Windows desktop app and local Windows daemon                   | E6                 |
| 5     | Linux desktop app and local Linux daemon                       | E7                 |

## 8. Global requirements

Global requirements apply to every epic. An epic is not done until every global
requirement holds for everything that epic delivers, on every platform it
delivers (§7.4). A requirement about a capability that does not exist yet (for
example the Windows named pipe in SEC-01) applies from the epic that builds that
capability.

### 8.1 Accessibility (A11Y)

Accessibility is a functional must-have, not polish. These requirements apply to
every surface the product shows: terminal, review mode, session list, dialogs,
menus, settings and notifications.

Keyboard shortcuts named here and in the user stories are **proposed defaults**.
The design phase fixes the final key map and tests it against the global
shortcuts of each OS, desktop environment and screen reader in the matrix. Every
shortcut MUST be rebindable (A11Y-05).

#### A11Y-01 — The terminal identifies itself to assistive technology

When focus lands on a terminal, assistive technology MUST know which session it
is and how to work it, so the user never guesses where keystrokes go.

1. When the terminal receives focus, it exposes through the platform API an
   accessible name made of the session name and host (for example
   "build, devbox-1"), the role of an editable text input, and its state (for
   example "disconnected").
2. The accessible description names the accessibility-help and leave-terminal
   shortcuts. A verbosity setting turns this hint off.
3. NVDA and JAWS switch to focus (forms) mode automatically when the terminal
   receives focus. VoiceOver, Narrator and Orca need no extra step before the
   user can type.
4. Typed characters and words echo according to the screen reader's own
   typing-echo settings. Characters echoed back by the shell are not spoken a
   second time.
5. The window title is the active session name, its host and the app name, and
   updates when the active session changes.

#### A11Y-02 — Output is announced as it arrives

New output in the focused session MUST be spoken automatically, so the user
hears what a command did without leaving the prompt.

1. New output in the focused session is announced politely, without moving
   focus, on every platform in the AT matrix.
2. Output is announced as logical lines: soft-wrapped rows are joined, escape
   sequences are removed, and prompt redraws, cursor moves and progress-bar
   overwrites collapse to the final text of the line.
3. Flood control: when output exceeds a configurable rate, the app stops
   line-by-line speech, announces a summary such as "312 lines of output", and
   resumes normal announcements when output pauses. The full text remains
   available in review mode.
4. A shortcut mutes and unmutes output announcements for the session. The new
   state is announced and shown in the status bar.
5. In the alternate screen buffer (full-screen programs such as vim, less and
   htop), the app announces the line at the cursor when the cursor moves or that
   line changes, not every repaint.
6. The screen reader's stop-speech command works as it does in native apps; the
   app does not re-queue interrupted speech.
7. Output in background sessions is not announced. Background events are
   covered by US-4.3.

#### A11Y-03 — Review mode: read and navigate the whole buffer

Users MUST be able to move through everything a terminal printed with their
screen reader's normal reading commands, to re-read errors, long logs and
full-screen program output.

1. One shortcut (proposed: Alt+F2 on Windows and Option+F2 on macOS, matching
   the VS Code Accessible View; the Linux default is set in design because
   GNOME reserves Alt+F2) opens review mode for the focused session. The same
   shortcut or Escape returns focus to the terminal input. Opening review mode
   never sends input to the process.
2. Review mode presents the scrollback and current screen as a read-only,
   multi-line text field. The field holds a page of logical lines around the
   review caret (initially 500, kept by spike S3a and measured again when
   review mode is built) and loads the adjacent page
   seamlessly when the caret crosses a page edge; start and end commands reach
   the start and end of the whole buffer. Each screen reader in the matrix
   navigates it by character, word, line, paragraph, page and start/end with
   its standard text-field reading commands (VoiceOver cursor and rotor, NVDA
   and JAWS caret navigation in focus mode, Narrator, Orca caret navigation).
   Browse and scan modes over the whole buffer are not required: a single
   element holding a buffer of this size has frozen screen readers.
3. The review caret opens on the line that holds the terminal cursor.
4. Soft-wrapped lines read as one logical line, trailing blanks are trimmed, and
   wide (CJK, emoji) and combining characters read correctly.
5. Output that arrives while review mode is open does not move the review caret
   or interrupt reading. A polite "new output" notice is announced at most once
   per burst, and a shortcut jumps to the end.
6. Find (Cmd+F on macOS, Ctrl+F elsewhere) searches the buffer, announces
   "match 3 of 17" and moves the review caret to the match.
7. Braille displays show the line at the review caret, and cursor routing keys
   move the review caret.
8. Shift with arrow, Home, End, Page Up and Page Down selects text, and the
   platform copy shortcut copies it. Selection behaves as in A11Y-04,
   including its size cap (A11Y-04 item 7).

#### A11Y-04 — Selected text is real, OS-visible selection

Text selected in the terminal MUST be the operating system's selected text, so
that Speak Selection, a screen reader's "read selection" command, Look Up and
read-aloud tools work on it.

1. Every selection — mouse drag, double-click (word), triple-click (line),
   Shift+click (extend, a single-pointer alternative to dragging), keyboard
   selection in review mode, Select All, and "select last command output" — is
   exposed, up to the size cap in item 7, as the selection of the focused
   accessible text element through the platform API:
    - macOS: `AXSelectedText`, `AXSelectedTextRange` and
      `AXSelectedTextMarkerRange` of the terminal's text field, as spike S2
      confirmed for R1.
    - Windows: UI Automation `TextPattern` selection, and IAccessible2 text
      selection for clients that use it.
    - Linux: AT-SPI2 `Text` interface selection.
2. These work on the selection in both the live terminal and review mode:
   macOS Spoken Content "Speak Selection"; each screen reader's command for
   reading the current selection, where it has one; macOS Look Up and the
   Services menu. On Linux, selecting sets the PRIMARY selection.
3. Selection changes are announced as in native text fields.
4. Selection is visible in every theme, including high contrast and Windows
   contrast themes. The highlight has at least 3:1 contrast with the adjacent
   background, and selected text has at least 4.5:1 contrast with the highlight.
5. Selection stays anchored to buffer content while new output arrives, until
   the user clears it or its text leaves the scrollback.
6. Copy places exactly the selected text on the clipboard: logical lines, no
   trailing padding. On Windows and Linux, Ctrl+C copies when a selection exists
   and sends an interrupt otherwise (configurable); Ctrl+Shift+C always copies.
   On macOS, Cmd+C copies.
7. A selection larger than the platform API can hold in accessible text (an
   initial cap of 5,000 lines, set by spike S3a) is exposed to the OS up
   to the cap. Copy still places the entire selection on the clipboard, and the
   app announces that the selection is larger than assistive technology can
   read at once.

#### A11Y-05 — Everything works from the keyboard, and the terminal never traps focus

Users MUST be able to do everything from the keyboard and always leave the
terminal.

1. Every function the product offers is operable from the keyboard alone, with
   no timing requirement.
2. In the terminal, keys go to the process — including Tab, Escape and
   Ctrl+letter — except a small set of app shortcuts. A documented key that is
   always available (proposed: Ctrl+F6 and Ctrl+Shift+F6) moves focus to the
   next or previous region: session list, terminal, status bar. Plain F6, the
   Windows convention for moving between panes, can be enabled in settings. It
   is not the default because full-screen programs such as htop and mc use F6.
3. A "send next key to terminal" command sends any app-reserved key to the
   process.
4. A toggle makes Tab and Shift+Tab move focus out of the terminal instead of
   reaching the process. Its state is announced and shown in the status bar.
5. Every app shortcut uses Ctrl, Alt/Option or Cmd, or a function key. No
   shortcut is a printable character alone or with only Shift. All shortcuts
   are rebindable and listed in accessibility help.
6. Default shortcuts do not collide with control codes the shell needs (for
   example Ctrl+M is Enter, Ctrl+I is Tab, Ctrl+[ is Escape) or with screen
   reader and OS global commands.
7. Focus order across regions and within dialogs follows the visual layout.
8. Escape closes dialogs and menus and returns focus to the element that opened
   them.

#### A11Y-06 — The operating system tracks focus and the text cursor

Magnifiers and other AT MUST be able to follow the terminal cursor and keyboard
focus at any zoom level.

1. Exactly one element is reported as focused through the platform API at all
   times, and it is the visually focused element. Focus changes raise the
   platform's focus events.
2. While the terminal is focused, the text caret position and bounds reported to
   the OS match the visible terminal cursor and update whenever it moves,
   including moves made by the shell or a full-screen program.
3. macOS Zoom, Windows Magnifier and GNOME Magnifier follow the terminal cursor,
   and follow focus in the session list, menus and dialogs.
4. IME candidate windows and OS dictation UI appear at the terminal cursor.
5. Pointer-based reading works on terminal text: macOS "Speak items under the
   pointer" and Hover Text, and screen readers' mouse-tracking features where
   they provide them (for example NVDA mouse tracking), read the text under the
   pointer.
6. Every focusable element shows a visible focus indicator with at least 3:1
   contrast against adjacent colors, and app overlays (headers, toasts, panels)
   never fully hide the focused element. The terminal cursor has at least 3:1
   contrast against adjacent colors, and the terminal draws distinct focused
   and unfocused cursors.

#### A11Y-07 — Contrast, themes, zoom and OS display settings

The terminal and UI MUST stay readable at any size and contrast setting.

1. App UI meets 4.5:1 text contrast (3:1 for large text) and 3:1 non-text
   contrast in every built-in theme.
2. The terminal enforces a minimum contrast ratio between each glyph's
   foreground and background — default 4.5:1, user-adjustable, can be turned
   off — by adjusting program-supplied colors. Low-contrast ANSI colors chosen by
   programs stay readable.
3. Built-in themes: Midnight (the default, a high-contrast dark theme), light,
   dark, high-contrast light and high-contrast dark. With "Match System", the
   app follows the OS light/dark setting, Windows contrast themes (forced
   colors: system colors in UI and terminal), macOS Increase Contrast and GNOME
   High Contrast. The UI and the terminal have separate palettes in every theme.
4. Terminal font size and app zoom scale to at least 200% by shortcut and
   setting without loss of content or function. The terminal recomputes rows and
   columns and resizes the PTY.
5. At 320 CSS pixels wide (1280 pixels at 400% zoom) and at 256 CSS pixels
   high, app UI reflows without two-dimensional scrolling: the sidebar
   collapses into a toggleable panel. Review mode wraps long lines instead of
   scrolling horizontally. The terminal grid is two-dimensional content
   excepted by WCAG 1.4.10 and adapts by reducing its column count.
6. App UI and review mode tolerate the WCAG 1.4.12 text-spacing overrides
   without clipping or overlap. The terminal grid offers line-height and
   letter-spacing settings.
7. App UI never conveys information by color alone. Session states use text and
   an icon.
8. Cursor shape (block, bar, underline) and bar thickness are configurable.

#### A11Y-08 — Motion, blinking, flashing and auto-scroll

Nothing on screen MUST blink, flash or move unless the user wants it to.

1. Cursor blinking and blinking text (SGR 5) can be turned off, and are off
   automatically when the OS reduce-motion setting is on. When enabled, blinking
   stops after 5 seconds without input.
2. The visual bell never flashes more than three times in any one-second period
   and has non-flashing alternatives: a session badge, a sound and an
   announcement.
3. App animations respect the OS reduce-motion setting.
4. Scrolling up pins the viewport: new output does not move it until the user
   returns to the bottom. A visible and announced "new output below" indicator
   appears while pinned.

#### A11Y-09 — Voice control, dictation and input methods

Users MUST be able to drive the app by voice and dictate into the terminal.

1. Every control's accessible name contains its visible label, so commands such
   as "Click New Session" work in macOS Voice Control and Windows Voice Access.
2. Session list items can be targeted by voice by name and by numbered overlay.
3. OS dictation (macOS Dictation, Windows Voice Typing, Voice Access dictation)
   inserts text at the terminal cursor and sends it to the process as typed text.
4. IME composition (CJK and others) works. Screen readers announce composition
   text as in native fields, and committed text reaches the process exactly once.
5. macOS Full Keyboard Access operates every control.

#### A11Y-10 — Accessibility help, settings and screen-reader mode

Users MUST be able to learn the app with their AT and without sighted help.

1. Accessibility help (proposed: Alt+F1 on Windows and Option+F1 on macOS; the
   Linux default is set in design because GNOME reserves Alt+F1) opens an
   accessible dialog listing the shortcuts for the current context (terminal,
   review mode, session list) with links to documentation. It is also
   reachable from the Help menu, which sits in the same place in every window.
2. When Chromium's accessibility support turns on — which happens when any
   assistive technology is detected, not only a screen reader — the app enables
   screen-reader-optimized behavior. On every OS the user can force it on or
   off from settings and from a command-line flag. The change is announced.
3. Accessibility settings — announcement verbosity, flood-control threshold,
   audio cues, minimum contrast ratio, cursor blink, Tab focus mode and hints —
   live on one searchable settings page that is fully operable by keyboard and
   screen reader.
4. User documentation ships as accessible HTML and includes a quick-start for
   each screen reader in the matrix on the platforms delivered so far.
5. Instructions never rely on sensory characteristics alone (for example "click
   the green icon").

#### A11Y-11 — Every application surface is accessible

Every control, list, dialog, form, menu and notification the product shows MUST
meet WCAG 2.2 AA through the platform accessibility API.

1. Every control exposes name, role, state and value. Accessible names contain
   the visible label. Icons have text alternatives; decorative icons are hidden.
2. Window regions are named landmarks or groups. Lists and trees use their
   native roles and keyboard models.
3. Interactive targets are at least 24 by 24 CSS pixels. No function requires a
   multipoint or path-based gesture, and pointer activation happens on release.
   Every drag (sidebar resize, session reorder, text selection) has a keyboard
   and a single-pointer alternative.
4. The layout works in any display orientation.
5. Regions, menus and commands appear in the same relative order in every
   window and view, and a function has the same label and icon everywhere.
6. Form fields have labels and, where needed, instructions. Errors are
   identified in text and suggest a fix. Fields that collect information about
   the user expose their input purpose. Previously entered values are offered
   again so the user does not re-type them.
7. Tooltips and other hover or focus content are dismissible with Escape,
   hoverable and persistent.
8. No dialog, confirmation or prompt has a time limit.
9. Actions that delete user data (closing a session with scrollback, removing a
   daemon, forgetting a host) require a confirmation that names what will be
   deleted.
10. Moving focus never switches the active session or opens a window. Changing
    a setting never moves focus, opens a window or switches the session unless
    the control says in advance that it will.
11. Context menus open from the keyboard (Shift+F10, the Menu key, and
    Ctrl+click on macOS), and every action is also available from the command
    palette.
12. The UI language is exposed programmatically, and UI passages in another
    language are marked.

#### A11Y-12 — Status messages and audio cues

Every change the user needs to know about MUST reach them without moving focus.

1. State changes, progress, results and errors are announced without moving
   focus: politely for information, assertively when they block the user's
   task.
2. Host connection changes (disconnected, reconnecting, restored) are announced.
3. Announcements are rate-limited and merged per session so bursts do not flood
   speech.
4. Audio cues last under 3 seconds, have a volume control and an off switch,
   and always have a spoken or visual equivalent.

### 8.2 Security and privacy (SEC)

#### SEC-01 — No network listeners

The app and daemons MUST open no network ports, so installing them adds no
attack surface to any host.

1. No component accepts inbound network traffic on any host: no TCP listening
   socket, including loopback, and no UDP socket bound to receive unsolicited
   datagrams. Chromium features that would open such sockets are disabled.
2. The daemon listens only on a Unix domain socket (macOS, Linux) inside a
   per-user directory with mode 0700, socket mode 0600; or on a Windows named
   pipe whose access control list grants access only to the user's account and
   rejects remote clients.
3. Automated tests assert, after install, connect and session creation on
   every supported OS, that product processes own no TCP socket in the LISTEN
   state and no UDP socket bound to a fixed or wildcard port.

#### SEC-02 — Access is limited to the user, enforced by the OS

Only the user's own account MUST be able to reach their daemon, so other users
on a shared host cannot see or type into their sessions.

1. The daemon verifies the connecting peer's OS identity — peer credentials on
   macOS and Linux, the pipe client's account on Windows — and rejects any peer
   that is not the daemon's own user.
2. Clients verify the endpoint before sending anything, so that another account
   cannot pre-create it to capture keystrokes. On macOS and Linux, the socket
   and its directory are owned by the user and not accessible to others. On
   Windows, the daemon creates its pipe as the first instance, and the client
   verifies that the pipe's server process runs as the user.
3. Authentication relies on the OS locally and on SSH remotely. The product
   mints no tokens, shared secrets or passwords of its own.

#### SEC-03 — The app never weakens SSH

The app's SSH connections MUST be at least as strict as the user's own.

1. The app never disables host key checking (US-1.2), never enables agent
   forwarding unless the user's SSH configuration does, and never enables
   password or keyboard-interactive authentication. Its security options
   override weaker settings in the user's SSH configuration (US-1.1).
2. The app stores no private keys, passphrases or passwords.

#### SEC-04 — Signed and verified binaries

The daemon on every host MUST be exactly what the vendor shipped, so the install
path cannot be used to plant code.

1. Desktop app builds are code-signed: Apple Developer ID with notarization on
   macOS, Authenticode on Windows, signed packages on Linux.
   **E1 exception:** E1 builds are ad-hoc signed and not notarized, because no
   Developer ID identity exists yet. Items 2–4 apply in full. The exception
   ends no later than the first build distributed beyond the owner.
2. Daemon binaries ship inside the signed app bundle. The app never downloads
   them from the network at install time.
3. After upload to a remote host, the binary's SHA-256 checksum is verified
   before it runs.
4. The daemon refuses to start if its binary or install directory is writable by
   other users.

#### SEC-05 — Session data at rest

Scrollback and session data stored on disk MUST be readable only by the user.

1. Scrollback and session metadata are stored in per-user directories readable
   only by the user (0700/0600; user-only access control lists on Windows).
2. Users control what is stored and can delete it on demand (US-3.2).

#### SEC-06 — Terminal output is untrusted

Programs and remote hosts MUST NOT be able to act on the user's computer through
escape sequences, so that `cat`-ing a hostile file is safe.

1. Clipboard writes from programs (OSC 52) are off by default and can be enabled
   per host. Clipboard read requests are always refused.
2. No escape sequence can run commands, open files or URLs, or change app
   settings without a user action.
3. Sequences that echo data back into the input stream, such as window title
   reporting, are disabled.
4. Titles, link targets and announcement text are stripped of control
   characters before display or speech.

#### SEC-07 — Least privilege

Nothing MUST run with elevated rights, so a bug in the product cannot compromise
a host.

1. Install, upgrade, operation and removal on every host run as the user,
   without root, sudo or administrator rights.
2. On Windows, the daemon runs outside the desktop app's process tree and job
   object so that closing the app cannot end it.

#### SEC-08 — Logs contain no secrets

Logs the user shares for support MUST contain nothing sensitive.

1. App and daemon logs never contain terminal output, keystrokes, environment
   variable values, private key material or clipboard contents.
2. Log files are readable only by the user.

### 8.3 Non-functional requirements (NFR)

All targets are initial and are validated during design. Each requirement
applies from the epic in the last column onward.

| ID     | Area                   | Requirement                                                                                                                                 | Initial target                                      | Applies from |
| ------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------ |
| NFR-01 | Input latency (local)  | Latency the app and daemon add between a keystroke and its echo, excluding the shell.                                                       | p95 ≤ 10 ms                                         | E5           |
| NFR-02 | Input latency (remote) | Same, for remote sessions.                                                                                                                  | p95 ≤ SSH round-trip time + 10 ms                   | E1           |
| NFR-03 | Throughput             | Under sustained output (for example `yes`, or `cat` of a 1 GB file), the UI stays interactive and Ctrl+C reaches the process quickly.       | Interrupt delivered p95 ≤ 100 ms                    | E1           |
| NFR-04 | AT responsiveness      | With a screen reader on, speech of new output starts promptly, and flood control keeps the screen reader responsive under sustained output. | Speech starts ≤ 500 ms after output, when idle      | E1           |
| NFR-05 | Scale                  | Sessions per host and hosts per app without breaching the latency targets; state changes reach attached clients quickly.                    | ≥ 100 sessions/host; ≥ 25 hosts; state p95 ≤ 250 ms | E1           |
| NFR-06 | Startup                | Window interactive after launch; remote reconnects started; local sessions listed.                                                          | ≤ 2 s; ≤ 1 s after window; ≤ 1 s after window       | E1; E2; E5   |
| NFR-07 | Reconnect              | Dead-connection detection; reconnection once the network is back.                                                                           | Detect ≤ 30 s; reconnect ≤ 5 s on a healthy network | E1; E2       |
| NFR-08 | Durability             | Lag between live output and on-disk scrollback, which bounds loss on power failure.                                                         | ≤ 5 s                                               | E3           |
| NFR-09 | Daemon footprint       | Idle daemon memory and CPU; overhead per session beyond scrollback.                                                                         | ≤ 30 MB RSS, ≤ 0.5% CPU idle; ≤ 10 MB/session       | E1           |
| NFR-10 | Scrollback             | Configurable per session with bounded memory.                                                                                               | Default 10,000 lines; configurable to ≥ 100,000     | E1           |
| NFR-11 | Reliability            | Session loss across automated soak cycles of app quit and crash, daemon kill and upgrade, and network flaps.                                | 0 sessions lost in 1,000 cycles per scenario        | E2           |
| NFR-12 | Compatibility          | App-to-daemon protocol compatibility.                                                                                                       | Current and previous protocol version               | E2           |
| NFR-13 | Localization           | UI strings externalized; UI language exposed programmatically.                                                                              | P0 ships English                                    | E1           |

## 9. Epics

P0 is delivered in seven epics, in order. Each epic ships a signed build that
users install and use for real.

An epic is done when all of the following hold:

1. Every user story in its acceptance criteria is fully implemented.
2. Every global requirement (§8) holds for everything the epic delivers, on the
   AT matrix cells of the desktop platforms delivered so far (§7.3, §7.4).
3. The NFRs that apply from that epic or earlier meet their targets.
4. The risks the epic retires (§13) have verified mitigations.
5. Nothing from earlier epics regresses.

The implementation breakdown of each epic lives in a separate plan per epic,
`docs/plans/epic-NN-implementation-plan.md`.

| Epic                                                               | Users can…                                                                                                           | Desktop               | Hosts                       | User stories |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------- | ------------ |
| [E1](#91-e1--accessible-remote-terminal-macos-app-to-linux-hosts)  | Run and manage terminal sessions on Linux hosts from an accessible macOS app                                         | macOS                 | Linux                       | 14           |
| [E2](#92-e2--remote-sessions-that-outlive-the-app-and-the-network) | Quit, sleep or roam and come back to the same running sessions, from more than one Mac                               | macOS                 | Linux                       | 6            |
| [E3](#93-e3--sessions-that-survive-a-host-reboot)                  | Get sessions back, with their history, after a host restarts, manage each host's daemon, and keep the app up to date | macOS                 | Linux                       | 4            |
| [E4](#94-e4--command-aware-terminal)                               | Jump between commands, hear exit status and background events, reach any session fast                                | macOS                 | Linux                       | 4            |
| [E5](#95-e5--local-sessions-on-the-mac-and-macos-hosts)            | Run persistent local sessions on the Mac, and add macOS hosts                                                        | macOS                 | Linux, macOS, this Mac      | 5            |
| [E6](#96-e6--windows-desktop)                                      | Do everything above from Windows, with persistent local Windows sessions                                             | macOS, Windows        | Linux, macOS, this computer | 3            |
| [E7](#97-e7--linux-desktop)                                        | Do everything above from Linux, with persistent local Linux sessions                                                 | macOS, Windows, Linux | Linux, macOS, this computer | 2            |

### 9.1 E1 — Accessible remote terminal: macOS app to Linux hosts

**Outcome.** A macOS user — including VoiceOver, Zoom and Voice Control users —
adds a Linux host they reach with SSH keys, and runs, switches and manages any
number of terminal sessions on it from a fully accessible app.

**Scope.** macOS desktop app; Linux x86_64 and arm64 hosts. Not yet: sessions
that outlive the app or a disconnect (E2), recovery after a host reboot (E3),
command navigation (E4), local sessions (E5).

**Acceptance criteria.** US-1.1 to US-1.14 are fully implemented, and the epic
completion conditions in §9 hold on the macOS cells of the AT matrix. Risks
retired: R1, R2, R9, R10.

#### US-1.1 — Add a Linux host

> As **Jordan**, I want to add any Linux host I can already reach with `ssh`, so
> that I can run sessions there without configuring anything new.

Acceptance criteria:

1. "Add host" offers the `Host` entries from the user's SSH configuration
   (including `Include` files) and accepts `[user@]host[:port]`. Previously used
   hosts are offered again.
2. The app uses the system OpenSSH client and honors the user's SSH
   configuration and agent: host aliases, `User`, `Port`, `IdentityFile`,
   `CertificateFile`, `IdentityAgent` and `SSH_AUTH_SOCK`, `ProxyJump` and
   `ProxyCommand`, `known_hosts`, and `ControlMaster` when configured. The app
   does not depend on `ControlMaster`, which the Windows OpenSSH client lacks
   (US-6.1).
3. Authentication is public key only, including certificates and FIDO security
   keys. The app never asks for a secret: no password, passphrase, PIN or
   keyboard-interactive prompt, and it disables those methods for its
   connections. A secret a key needs (a passphrase, a FIDO PIN) must already be
   handled by the user's agent; otherwise the connection fails with the US-1.3
   message.
4. Options the app sets for security — host-key checking, authentication
   methods, non-interactive mode — are passed on the command line, so they take
   precedence over the user's SSH configuration (SEC-03).
5. "Test connection" reports success or the specific failure (US-1.3).
6. The user-name field exposes its input purpose so autofill and AT recognize
   it.

#### US-1.2 — Verify the host's identity

> As **Jordan**, I want to confirm a host's key the first time and be protected
> if it changes, so that I never connect to an impostor.

Acceptance criteria:

1. For an unknown host key, the app shows host, key type and SHA-256 fingerprint
   in an accessible dialog with no time limit. The fingerprint is copyable so the
   user can compare it with a tool instead of from memory. Accepting records the
   key in the user's `known_hosts`. Rejecting aborts. The app's connections are
   non-interactive, and OpenSSH in batch mode refuses an unknown key instead of
   asking. The app therefore obtains the presented key itself and records it
   only after the user accepts. The mechanism is a design decision.
2. For a changed host key, the connection is refused with an explanation of the
   risk and how to resolve it. The app offers no "connect anyway" option.
3. The app never disables or relaxes host key checking.

#### US-1.3 — Clear authentication and connection failures

> As **Jordan**, I want every failure to say what went wrong and how to fix it,
> so that I am never stuck at a silent spinner.

Acceptance criteria:

1. Specific messages with remedies exist for: no agent running; agent has no
   identities; key rejected by the host; passphrase-protected key not loaded in
   the agent; key needs a PIN the agent cannot supply; expired certificate;
   host unreachable, DNS failure or timeout; jump host failure.
2. When a FIDO security key needs a touch, the app shows and announces "Touch
   your security key for devbox-1" and waits.
3. Errors are text, announced (assertively when they block the user's task),
   and include copyable details.

#### US-1.4 — The daemon installs itself on the host

> As **Jordan**, I want the app to put its daemon on a host the first time I
> connect, without sudo or internet on the host, so that sessions there just
> work.

Acceptance criteria:

1. After connecting, the app detects the host's OS and architecture (Linux
   x86_64 or arm64) and checks for a compatible daemon in the per-user install
   location.
2. If the daemon is missing or older, the app uploads the matching daemon binary
   bundled with the app over the existing SSH connection, verifies its SHA-256
   checksum on the host, installs it atomically (an interruption never leaves a
   half-installed daemon), and starts it as the user.
3. No root, no sudo, no package install and no outbound internet access are
   required. The install location is configurable per host for hosts whose home
   directory does not permit execution.
4. An unsupported OS or architecture, or a missing prerequisite, produces a
   message naming what is missing and leaves nothing behind.
5. Each step (connecting, checking, uploading, verifying, starting) is shown and
   announced politely; completion is announced.
6. App and daemon negotiate a protocol version. The app never downgrades a
   daemon; if a host runs a newer daemon than the app supports, the app asks the
   user to update the app.
7. Until E2 (US-2.5), upgrading the daemon may end running sessions. When
   sessions are running, the app says so and asks before upgrading.

#### US-1.5 — Tunneled connection with no exposed ports

> As **Jordan**, I want the app to reach the remote daemon through SSH without
> any setup, so that nothing new is exposed on my hosts.

Acceptance criteria:

1. All communication between the app and a remote daemon travels inside the
   authenticated SSH connection. The remote daemon opens no TCP port, not even
   on loopback.
2. One SSH connection per host carries all of that host's sessions. New sessions
   on a connected host open without a new SSH authentication.
3. The connection works when the SSH server disables TCP and Unix-socket
   forwarding, as long as it permits command execution.
4. Setup, multiplexing and teardown are invisible to the user. There is nothing
   to configure.
5. Keepalives detect a dead connection within the NFR-07 detection target, and
   the app reports it (US-1.14).

#### US-1.6 — Workspace layout

> As **Jordan**, I want sessions listed on the left by host and the selected
> terminal in the center, so that I see everything at once.

Acceptance criteria:

1. The window has three regions: session sidebar (left), terminal (center), and
   status bar (bottom: host connection, daemon state, Tab focus mode,
   announcement mute).
2. The sidebar groups sessions by host, in user-defined order. Each host group
   shows its connection state and can collapse. "This computer" joins the top
   of the list in E5.
3. The sidebar resizes by pointer, by keyboard command and by setting, and
   collapses. Its width persists.
4. The session list is an accessible tree (host, then sessions) with arrow-key
   navigation, type-ahead and Home/End. Each item announces name, host, state,
   badges and position ("3 of 7").
5. The app is single-instance on a computer: launching it again focuses the
   existing window.

#### US-1.7 — Create a session

> As **Jordan**, I want to open a new terminal instantly, so that starting work
> costs nothing.

Acceptance criteria:

1. "New session" (shortcut, button, menu, command palette) creates a session on
   the focused session's host, or on the last-used host, with the user's login
   shell in the home directory or the focused session's working directory
   (configurable), and focuses it.
2. "New session…" opens a dialog to choose host, shell profile, working
   directory, name and environment overrides.

#### US-1.8 — Switch between sessions

> As **Jordan** and **Sam**, I want to move between sessions without hunting,
> so that dozens of sessions stay manageable.

Acceptance criteria:

1. Enter or click on a session list item opens it. Moving focus within the list
   does not switch the terminal.
2. Next-session and previous-session shortcuts exist.
3. Opening a session moves focus to its terminal and announces its name, host,
   state and whether it has unread output. Each session keeps its own scroll
   position.

#### US-1.9 — Session state at a glance

> As **Jordan**, I want each session's state visible in the list, so that I know
> what needs attention.

Acceptance criteria:

1. The daemon is the only owner of session processes. It creates the PTY and
   the process, and tracks process ID, state, start time, exit code or signal,
   and last-output time.
2. States: Starting, Running, Exited (with exit code or signal), Stopped,
   Disconnected, Failed to start (with reason). E2 adds Reconnecting; E3 adds
   Restored.
3. Each state shows as text plus icon and is part of the item's accessible name
   or description. Last activity time is available on demand.
4. State changes reach the app within the NFR-05 target.

#### US-1.10 — Manage sessions

> As **Jordan**, I want to rename, restart, stop, close, duplicate and reorder
> sessions, so that the list matches how I work.

Acceptance criteria:

1. Rename: the title a program sets (OSC 0/2) shows until the user renames the
   session; the user's name then wins.
2. Stop: graceful first, then forced after a configurable grace period
   (SIGHUP, then SIGTERM, then SIGKILL).
3. Restart: stop if running, then start with the same shell, arguments, last
   known working directory, environment and size. The scrollback stays, with a
   "restarted" marker line.
4. Close: stops the session if running and removes it and its scrollback, after
   a confirmation that names what will be deleted.
5. Duplicate: new session on the same host, with the same shell and current
   working directory.
6. Reorder by "Move up" and "Move down" commands as well as by dragging.
7. A session whose process exits with code 0 closes on its own and leaves the
   list. Sessions that exited with another code or a signal stay in the list
   with exit status and scrollback until closed, so the user can see why.
   Auto-close on clean exit is configurable and on by default.

#### US-1.11 — Terminal emulation fidelity

> As **Jordan**, I want every program I use to behave exactly as in my usual
> terminal, so that I can switch without relearning.

Acceptance criteria:

1. xterm-compatible emulation (`TERM=xterm-256color`), 24-bit color, Unicode
   with wide, combining and emoji grapheme clusters, alternate screen, mouse
   reporting, bracketed paste and focus reporting.
2. OSC 0/2 titles, OSC 7 working directory, OSC 8 hyperlinks and OSC 133 shell
   integration marks.
3. Resizing the terminal resizes the PTY and notifies the process.
4. Configurable scrollback, default 10,000 lines (NFR-10).
5. Verified programs on Linux hosts: vim and neovim, less, top and htop, nested
   tmux, git, ssh and the Python REPL.

#### US-1.12 — Copy, paste and links

> As **Jordan**, I want copy, paste and links to work the way my OS works, so
> that I never think about them.

Acceptance criteria:

1. Copy follows A11Y-04. Paste: Cmd+V on macOS; Ctrl+Shift+V and Shift+Insert
   on Windows and Linux (from E6 and E7); context menu everywhere.
2. Bracketed paste is used when the program enables it. Pasting multiple lines
   asks for confirmation and states the line count (on by default, can be
   disabled).
3. Hyperlinks (OSC 8) and detected URLs and file paths open by modifier+click
   and from the keyboard through a "list links" command and review mode. The
   target is shown before opening when it differs from the link text.

#### US-1.13 — Find in the terminal

> As **Jordan**, I want to search the scrollback, so that I find an error
> without scrolling.

Acceptance criteria:

1. Find searches the session's scrollback with case-sensitive and regular
   expression options.
2. The match count and current match ("3 of 17") are shown and announced.
3. Matches are highlighted with the contrast required by A11Y-04.
4. Escape closes find and returns focus to the terminal.

#### US-1.14 — Connection loss is visible and safe

> As **Sam**, I want to know at once when a host drops and never have my
> keystrokes go anywhere unexpected, so that a network blip cannot hurt me.

Acceptance criteria:

1. When the connection to a host is lost, its sessions show Disconnected, and
   the change is announced (A11Y-12).
2. While disconnected, the terminal neither accepts input nor buffers it for
   later delivery. A keystroke produces "Disconnected — input not sent", shown
   and announced.
3. A Reconnect action reconnects to the host and lists the sessions running
   there. Sessions are guaranteed to survive a connection loss from E2.

### 9.2 E2 — Remote sessions that outlive the app and the network

**Outcome.** Users close the app, sleep or reboot the Mac, or change networks,
and their remote sessions keep running. The app reconnects by itself and
reattaches to everything. The same session can be open on two Macs at once.
Daemon crashes and upgrades never cost a session.

**Scope.** macOS desktop app; Linux hosts. Not yet: recovery after a host reboot
(E3).

**Acceptance criteria.** US-2.1 to US-2.6 are fully implemented, and the epic
completion conditions in §9 hold on the macOS cells of the AT matrix. Risks
retired: R4 (Linux), R5 (Linux), R6.

#### US-2.1 — Sessions outlive the app

> As **Jordan**, I want my remote terminals to keep running when I close the
> app, so that I can quit without losing work.

Acceptance criteria:

1. Quitting the app (menu, shortcut, closing the last window), an app crash, a
   force-kill and an app update end no session and no process started in a
   session.
2. While no app is attached, the daemon keeps reading each session's output into
   scrollback. Programs never block because no client is attached. Output is
   retained up to the scrollback limit.
3. When the app reconnects, every session shows its current state and the output
   produced while the app was away.
4. An explicit, confirmed "Quit and stop all sessions" command exists.
5. On first run, the app tells the user that sessions keep running after the app
   closes and how to stop them.

#### US-2.2 — Sessions survive disconnects and reconnect by themselves

> As **Jordan**, I want remote sessions to keep running when my laptop sleeps or
> my network drops, and to reconnect by themselves, so that a flaky network
> costs me nothing.

Acceptance criteria:

1. Client sleep, network change, VPN drop and client reboot leave remote
   sessions running. The remote daemon keeps capturing their output.
2. On connection loss, the host's sessions show Disconnected, then Reconnecting.
   The app reconnects automatically with backoff, retrying at once on network
   change and wake events. On success, it reattaches, fetches the missed output
   (up to the scrollback limit) and shows and announces "Reconnected"
   (NFR-07).
3. The user can retry immediately or stop retrying, per host.
4. When reconnection needs user action — locked agent, expired certificate —
   the app says so (US-1.3) and resumes when the user selects Retry.

#### US-2.3 — Restore remote connections on launch

> As **Jordan**, I want the app to reconnect every host when it starts, so that
> after a reboot I am back where I was without clicking anything.

Acceptance criteria:

1. At launch, the app reconnects in parallel, without user action, to every
   remote host that had sessions when it last ran (NFR-06).
2. Sessions appear at once from cached metadata, marked Reconnecting, and update
   to live state as each host connects.
3. Hosts that fail show the reason and retry as in US-2.2.
4. Restoring never blocks the UI. The user can work in any available session
   while others restore.

#### US-2.4 — Sessions persist on every Linux host, or the app says why not

> As **Jordan**, I want the daemon to stay alive after I disconnect from any
> Linux host, and to be told plainly when a host cannot allow that, so that I am
> never surprised by lost sessions.

Acceptance criteria:

1. The daemon runs in a way that outlives the SSH connection. It is a systemd
   user unit only when lingering is enabled or the user can enable it.
   Otherwise, it is a detached process outside the user's systemd instance.
2. The reason for criterion 1: without lingering, systemd stops the user's
   service manager, and every user unit with it, shortly after the last login
   session ends (`UserStopDelaySec`). The app's SSH connection is that session.
3. On hosts that keep user processes after logout (`KillUserProcesses=no`),
   sessions survive disconnects with or without lingering.
4. On hosts that end user processes at logout (`KillUserProcesses=yes`) and
   where lingering is unavailable, sessions end when the last connection closes.
   The app warns about this before the first session is created on the host,
   and the host's status shows it.

#### US-2.5 — Daemon crashes and upgrades never lose sessions

> As **Jordan**, I want a daemon crash or upgrade to be invisible to my
> sessions, so that maintenance never costs me work.

Acceptance criteria:

1. If the daemon crashes or is killed, it restarts — by the service manager
   where it is registered, otherwise by the app as soon as it notices. Running
   sessions and their processes are unaffected, keep capturing output, and are
   re-adopted by the restarted daemon.
2. The processes that hold PTYs, and the session processes, run outside the
   daemon's service-manager kill scope: outside the systemd unit's control
   group (here), outside the launchd job's process group (E5), and attached to a
   ConPTY owner that outlives the daemon core (E6). A per-OS automated test
   kills the daemon, lets it restart, and asserts that every shell survives.
3. When the app ships a newer daemon, the app upgrades the installed daemon in
   place without ending sessions. Sessions created before the upgrade keep
   working. This replaces the US-1.4 upgrade warning.
4. The app supports the current and previous daemon protocol versions so hosts
   can upgrade lazily (NFR-12). On an incompatible version, the app offers
   "Upgrade daemon", which keeps sessions.

#### US-2.6 — Several clients share a session

> As **Jordan**, I want my laptop and my workstation attached to the same
> session at once, so that I can move between machines without detaching.

Acceptance criteria:

1. Any number of desktop app instances, on different computers, attach to the
   same session at the same time. All receive output in real time and all can
   send input. A host's sessions are reachable by the app on that host through
   local IPC (from E5), and by apps on other computers that reach the host over
   SSH (US-1.5). No other path exists.
2. The PTY size follows the most recently active client (last input or focus).
   Other clients render the session at that size and indicate "Size set by
   another client".
3. Session list changes (create, rename, reorder, close, state) reach every
   attached client.
4. When input from another client arrives in the focused session, the app SHOULD
   announce it once per burst ("Input from another client").

### 9.3 E3 — Sessions that survive a host reboot

**Outcome.** When a Linux host reboots, its sessions come back with the same
shell, working directory and name, and with the previous output above a
marker. Users see and manage each host's daemon from the app, and the app
keeps itself up to date.

**Scope.** macOS desktop app; Linux hosts.

**Acceptance criteria.** US-3.1 to US-3.4 are fully implemented, and the epic
completion conditions in §9 hold on the macOS cells of the AT matrix.

#### US-3.1 — Sessions come back after a host reboot

> As **Jordan**, I want sessions on a rebooted host to come back by themselves,
> so that host maintenance is a minor interruption, not a reset.

Acceptance criteria:

1. The daemon starts at boot when lingering is enabled. Otherwise it starts when
   the app reconnects and finds it stopped (US-2.4).
2. Scrollback is persisted to disk continuously (NFR-08, SEC-05).
3. For each session that was running at shutdown — not ones the user stopped or
   closed — the daemon starts a new process with the same shell, arguments,
   name, size and list position, the environment the session was started with,
   and the last known working directory. The working directory comes from shell
   integration (OSC 7) when available (US-4.1), otherwise from the OS's process
   information, otherwise the session's initial directory. Variables the user
   exported inside the shell are not restored.
4. The previous scrollback is restored above a marker line: "Session restored
   after restart on <date time>. Previous processes ended." Restored scrollback
   is read-only history: it cannot be edited or sent to the process, and new
   output continues below the marker. The marker is plain text, read when the
   user opens the session and available in review mode.
5. Only the shell starts. Commands that were running are never re-executed.
6. The app shows these sessions as Restored and announces the restore when the
   host reconnects.
7. If the working directory no longer exists, the session starts in the home
   directory and says so.

#### US-3.2 — Choose what is restored and stored

> As **Jordan**, I want to decide which sessions come back and what is kept on
> disk, so that secrets printed in a terminal do not linger.

Acceptance criteria:

1. Each session has a "Restore after restart" setting, on by default.
2. Each session has a "Do not save scrollback to disk" setting. With it on, the
   session is restored without scrollback.
3. "Clear scrollback" also deletes the on-disk copy. Closing a session deletes
   its data.

#### US-3.3 — Manage each host's daemon

> As **Jordan**, I want to see and manage each host's daemon from the app, so
> that I never need to log in to fix it.

Acceptance criteria:

1. Each host shows connection status, daemon version, uptime, install path and
   log location. The daemon writes structured, rotated logs to a per-user
   location (SEC-08).
2. "Upgrade daemon" and "Restart daemon" keep sessions.
3. "Remove daemon from host" stops all sessions and removes the service
   registration, binaries and data, after a confirmation that lists the sessions
   that will stop and the data that will be deleted.
4. "Forget host" asks whether to leave the host's sessions running or to stop
   them and remove the daemon.
5. Documentation describes manual removal for every platform delivered so far.

#### US-3.4 — The app keeps itself up to date

> As **Jordan**, I want the app to update itself, so that I always run a
> version my hosts' daemons support without hunting for downloads.

Acceptance criteria:

1. The app checks for updates at launch and once a day, downloads them in the
   background, and installs an update only after verifying its code signature.
2. An update installs only when the user chooses to restart now or on the next
   quit. Checking and downloading never steal focus or interrupt typing.
   Update availability is announced politely and listed in the status bar
   notifications.
3. Updating ends no session (US-2.1) and the app reattaches every session after
   the restart (US-2.3). Host daemons are then upgraded as in US-2.5, keeping
   sessions.
4. Users can turn automatic checks off and check manually from the menu.
5. Before this story ships (E1 and E2), each release is a signed, notarized
   download that users install by hand.

### 9.4 E4 — Command-aware terminal

**Outcome.** Users jump between commands, hear when a command fails, learn when
something happens in another session, and reach any session by name with one
shortcut.

**Scope.** macOS desktop app; Linux hosts. PowerShell integration arrives in E6.

**Acceptance criteria.** US-4.1 to US-4.4 are fully implemented, and the epic
completion conditions in §9 hold on the macOS cells of the AT matrix.

#### US-4.1 — Shell integration without editing dotfiles

> As **Sam**, I want the terminal to know where each command starts and ends in
> my usual shells, without me changing my configuration, so that command
> navigation just works.

Acceptance criteria:

1. The app injects shell integration for bash, zsh and fish on every host,
   without modifying the user's shell startup files.
2. The integration emits OSC 133 marks (prompt, command, output, exit status)
   and the OSC 7 working directory. The app also reads these sequences from
   shells that emit them on their own.
3. The user can turn injection off per host.

#### US-4.2 — Navigate by command

> As **Sam**, I want to jump between commands and hear each one's output and
> exit status, so that I can find what failed without reading the whole log.

Acceptance criteria:

1. Shortcuts go to the previous and next command, in the terminal and in review
   mode, read the last command's output, and select or copy the last command's
   output.
2. When a command finishes in the focused session with a non-zero exit status,
   the app announces it ("Command failed, exit code 2"). Distinct optional audio
   cues mark success and failure. Both are configurable.
3. Without shell integration, command navigation is unavailable. Invoking it
   announces why. All other features still work.

#### US-4.3 — Events in background sessions

> As **Sam**, I want to hear when something important happens in a session I am
> not looking at, so that I do not have to poll every session.

Acceptance criteria:

1. When a background session rings the bell, its process exits, or a
   long-running command finishes (shell integration; threshold configurable),
   the app posts a polite announcement, an OS notification, or both
   (configurable per event type). Example: "Session build on devbox-1: command
   finished, exit code 1."
2. The session list shows the same events as text and icon badges. Badges are
   part of the item's accessible description until the session is viewed.
3. Announcements are merged per session as A11Y-12 requires.

#### US-4.4 — Reach any session with one shortcut

> As **Jordan** and **Sam**, I want to jump to any session by typing part of its
> name, so that dozens of sessions on many hosts stay manageable.

Acceptance criteria:

1. A quick switcher (shortcut) opens a filterable list of all sessions on all
   hosts, matching name, host and title, and announces the result count.
2. Choosing a result opens the session as in US-1.8.

### 9.5 E5 — Local sessions on the Mac, and macOS hosts

**Outcome.** "This computer" joins the sidebar. Local sessions on the Mac get
everything remote sessions have: they outlive the app, survive daemon crashes
and upgrades, and come back after a reboot or logout. Macs can be added as
remote hosts too.

**Scope.** macOS desktop app with the local macOS daemon; Linux and macOS hosts.

**Acceptance criteria.** US-5.1 to US-5.5 are fully implemented, and the epic
completion conditions in §9 hold on the macOS cells of the AT matrix. Risks
retired: R4 (macOS), R5 (macOS), R7.

#### US-5.1 — Local daemon set up on first launch

> As **Jordan**, I want the app to set up its background service the first time
> I launch it, without asking for an administrator password, so that local
> sessions persist from day one.

Acceptance criteria:

1. On first launch, and whenever the daemon is missing, the app installs the
   daemon bundled with the app into a per-user location, registers it as a
   launchd LaunchAgent, and starts it.
2. No step asks for an administrator password.
3. Progress and outcome are shown and announced. A failure names the cause and
   the next step.

#### US-5.2 — Local sessions work like remote sessions

> As **Jordan** and **Sam**, I want sessions on my Mac to work exactly like
> remote ones, so that location never changes how I work.

Acceptance criteria:

1. "This computer" appears first in the sidebar.
2. Every E1–E4 capability works the same for local sessions: create, switch,
   manage, emulation, copy and paste, find, shell integration, command
   navigation, background events and the quick switcher.
3. A local session's default shell is the user's login shell.
4. The app reaches the local daemon only through local IPC (SEC-01, SEC-02).
   Local input latency meets NFR-01.

#### US-5.3 — Local sessions outlive the app and the daemon

> As **Jordan**, I want my local terminals to keep running when I close the app
> or the daemon fails, so that I can quit without losing work.

Acceptance criteria:

1. Quitting the app, an app crash, a force-kill and an app update end no local
   session (as in US-2.1).
2. If the local daemon crashes or is killed, launchd restarts it, and sessions
   are unaffected (as in US-2.5).
3. Upgrading the local daemon keeps sessions.

#### US-5.4 — Local sessions come back after a reboot or logout

> As **Jordan**, I want my local sessions back after my Mac restarts, so that a
> reboot is a minor interruption, not a reset.

Acceptance criteria:

1. The daemon starts automatically at login.
2. Logging out ends user processes on macOS. Logout is therefore treated like a
   reboot.
3. After a reboot or logout, local sessions respawn as in US-3.1, with the
   US-3.2 controls.

#### US-5.5 — Add macOS hosts

> As **Jordan**, I want to add any Mac I reach with `ssh` as a host, so that my
> other Macs work like my Linux hosts.

Acceptance criteria:

1. Adding a host, verifying it, reporting failures, installing the daemon and
   every E1–E4 capability work for macOS hosts on arm64 and x86_64.
2. On a macOS host, the daemon is a launchd LaunchAgent when the user has a GUI
   login session. Otherwise, it is a detached daemon started over SSH, and after
   a reboot without a GUI login its sessions respawn when the app reconnects.
3. A Mac's local sessions are the same sessions another computer sees when it
   adds that Mac as a host. Sharing works as in US-2.6.

### 9.6 E6 — Windows desktop

**Outcome.** Everything from E1 to E5 works on Windows 11. JAWS, NVDA,
Narrator, Magnifier and Voice Access users reach Linux and macOS hosts, and run
persistent local PowerShell, cmd and WSL sessions.

**Scope.** Windows desktop app with the local Windows daemon; Linux and macOS
hosts.

**Acceptance criteria.** US-6.1 to US-6.3 are fully implemented, and the epic
completion conditions in §9 hold on the macOS and Windows cells of the AT
matrix. Risks retired: R4 (Windows), R5 (Windows), R8.

#### US-6.1 — The Windows app reaches every remote host

> As **Sam**, I want to use the app on Windows with JAWS or NVDA against all my
> hosts, so that I can work on the platform I am fastest on.

Acceptance criteria:

1. Every E1–E4 capability, and US-5.5, works from the Windows app against Linux
   and macOS hosts.
2. The app uses the OpenSSH client and agent that ship with Windows, as
   described in US-1.1.
3. Copy and paste follow Windows conventions (A11Y-04, US-1.12).

#### US-6.2 — Local Windows sessions

> As **Jordan**, I want persistent local PowerShell, cmd and WSL sessions on
> Windows, so that my Windows work survives the app too.

Acceptance criteria:

1. On first launch, the app installs the daemon per user, without
   administrator rights, with a per-user auto-start at login. The daemon runs
   outside the app's process tree and job object (SEC-07).
2. Local sessions run in ConPTY with PowerShell 7, Windows PowerShell 5.1, cmd
   and WSL distributions. "This computer" appears first in the sidebar.
3. Local sessions behave as in US-5.2 to US-5.4: every E1–E4 capability; they
   outlive the app; they survive daemon crashes and upgrades because each
   ConPTY owner outlives the daemon core (US-2.5); and they respawn after a
   reboot or logout.
4. Stop sends a close request, then terminates after the grace period.
5. The daemon is reached through a named pipe (SEC-01, SEC-02).
6. Verified programs add PowerShell with PSReadLine.

#### US-6.3 — Command-aware PowerShell

> As **Sam**, I want command navigation in PowerShell too, so that I get the
> same efficiency on Windows.

Acceptance criteria:

1. Shell integration (US-4.1) is injected for PowerShell, both locally and on
   remote hosts where PowerShell is installed.
2. Command navigation (US-4.2) and background events (US-4.3) work in
   PowerShell sessions.

### 9.7 E7 — Linux desktop

**Outcome.** Everything from E1 to E6 works on Linux desktops (Ubuntu LTS and
Fedora; GNOME on Wayland and X11) with Orca and GNOME Magnifier, including
persistent local sessions.

**Scope.** Linux desktop app with the local Linux daemon; Linux and macOS hosts.

**Acceptance criteria.** US-7.1 and US-7.2 are fully implemented, and the epic
completion conditions in §9 hold on all cells of the AT matrix. Risks retired:
R3.

#### US-7.1 — The Linux app reaches every remote host

> As **Sam**, I want to use the app on my Linux desktop with Orca against all my
> hosts, so that my platform choice never limits me.

Acceptance criteria:

1. Every E1–E4 capability, and US-5.5, works from the Linux app.
2. Selecting text sets the PRIMARY selection, and middle-click pastes
   (A11Y-04).
3. Default shortcuts avoid the keys GNOME reserves (Alt+F1, Alt+F2). Review
   mode and accessibility help get their Linux defaults (A11Y-03, A11Y-10).
4. Copy and paste follow Linux conventions (A11Y-04, US-1.12).

#### US-7.2 — Local Linux sessions

> As **Jordan**, I want persistent local sessions on my Linux desktop, so that
> my local work survives the app too.

Acceptance criteria:

1. On first launch, the app installs the daemon per user and registers it as a
   systemd user unit. Without a systemd user instance, the daemon runs as a
   detached process and the app states the reduced guarantee: no automatic
   start at login or boot.
2. Local sessions behave as in US-5.2 to US-5.4: every E1–E4 capability; they
   outlive the app; they survive daemon crashes and upgrades; and they respawn
   after a reboot.
3. Logging out ends local sessions unless lingering is enabled. Logout is then
   treated like a reboot.

## 10. WCAG 2.2 conformance mapping

The product targets WCAG 2.2 Level AA for every window and view. For non-web
software, the W3C note
[WCAG2ICT](https://www.w3.org/TR/wcag2ict-22/) guides interpretation. Where
WCAG2ICT finds a criterion's "set of pages" scope does not map to a single
application (2.4.1, 2.4.5, 3.2.3, 3.2.4, 3.2.6), the product still meets the
criterion's intent within the app.

Text that programs write to a terminal is third-party content. The product is
responsible for exposing it accessibly — as real text, with minimum contrast,
navigable, selectable — but not for the semantics of a program's own layout.

| SC          | Name                                      | Level | How it applies                                                                                                                                                                                                             | Requirements                      |
| ----------- | ----------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1.1.1       | Non-text Content                          | A     | Icons have text alternatives; decorative icons are hidden; audio cues have spoken or visual equivalents.                                                                                                                   | A11Y-11, A11Y-12                  |
| 1.2.1–1.2.5 | Time-based media                          | A/AA  | Not applicable: P0 contains no audio or video content. Future documentation videos need captions and audio description.                                                                                                    | —                                 |
| 1.3.1       | Info and Relationships                    | A     | Regions, session tree, dialog and field labels are exposed programmatically; terminal text is exposed as lines.                                                                                                            | A11Y-01, A11Y-03, A11Y-11, US-1.6 |
| 1.3.2       | Meaningful Sequence                       | A     | Terminal reading order is logical line order with soft wraps joined.                                                                                                                                                       | A11Y-02, A11Y-03                  |
| 1.3.3       | Sensory Characteristics                   | A     | Instructions do not rely on shape, color, position or sound alone.                                                                                                                                                         | A11Y-10                           |
| 1.3.4       | Orientation                               | AA    | The layout works in any display orientation.                                                                                                                                                                               | A11Y-11                           |
| 1.3.5       | Identify Input Purpose                    | AA    | The SSH user-name field exposes its purpose.                                                                                                                                                                               | A11Y-11, US-1.1                   |
| 1.4.1       | Use of Color                              | A     | States and errors never rely on color alone; the selection highlight also differs in luminance by at least 3:1.                                                                                                            | A11Y-04, A11Y-07, US-1.9          |
| 1.4.2       | Audio Control                             | A     | Audio cues are under 3 seconds with volume and off controls.                                                                                                                                                               | A11Y-12                           |
| 1.4.3       | Contrast (Minimum)                        | AA    | UI contrast in all themes; terminal minimum-contrast enforcement.                                                                                                                                                          | A11Y-07                           |
| 1.4.4       | Resize Text                               | AA    | Font size and zoom to at least 200%.                                                                                                                                                                                       | A11Y-07                           |
| 1.4.5       | Images of Text                            | AA    | No images of text in the UI. Terminal glyphs are rendered from user-selectable fonts. If they are drawn on a canvas or GPU surface, the Customizable exception applies, because font, size and colors are user-controlled. | A11Y-07                           |
| 1.4.10      | Reflow                                    | AA    | UI reflows at 320 CSS px; the terminal grid is two-dimensional content excepted by the criterion.                                                                                                                          | A11Y-07                           |
| 1.4.11      | Non-text Contrast                         | AA    | Focus indicators, control boundaries, cursor and selection at least 3:1.                                                                                                                                                   | A11Y-04, A11Y-06, A11Y-07         |
| 1.4.12      | Text Spacing                              | AA    | Applies to markup-based content: app UI and review mode tolerate the overrides. The terminal grid offers line-height and letter-spacing settings.                                                                          | A11Y-07                           |
| 1.4.13      | Content on Hover or Focus                 | AA    | Tooltips and link previews are dismissible, hoverable and persistent.                                                                                                                                                      | A11Y-11, US-1.12                  |
| 2.1.1       | Keyboard                                  | A     | Every function, including text selection, works from the keyboard.                                                                                                                                                         | A11Y-03, A11Y-05                  |
| 2.1.2       | No Keyboard Trap                          | A     | Region-cycling key, Tab focus mode, and the leave-terminal hint on focus.                                                                                                                                                  | A11Y-01, A11Y-05                  |
| 2.1.4       | Character Key Shortcuts                   | A     | No single-character shortcuts; all shortcuts rebindable.                                                                                                                                                                   | A11Y-05                           |
| 2.2.1       | Timing Adjustable                         | A     | No time limits on dialogs, confirmations or host-key prompts.                                                                                                                                                              | A11Y-11, US-1.2                   |
| 2.2.2       | Pause, Stop, Hide                         | A     | Blink controls. Terminal output is the primary content, not content presented in parallel with it; the user pauses it by scrolling back (pinned viewport) or reading in review mode, which does not move with output.      | A11Y-03, A11Y-08                  |
| 2.3.1       | Three Flashes or Below Threshold          | A     | Visual bell rate limit.                                                                                                                                                                                                    | A11Y-08                           |
| 2.4.1       | Bypass Blocks                             | A     | Named regions and region-cycling key.                                                                                                                                                                                      | A11Y-05, A11Y-11                  |
| 2.4.2       | Page Titled                               | A     | Window title names the session and host.                                                                                                                                                                                   | A11Y-01                           |
| 2.4.3       | Focus Order                               | A     | Focus order follows the visual layout; focus returns to the opener.                                                                                                                                                        | A11Y-05                           |
| 2.4.4       | Link Purpose (In Context)                 | A     | UI links are descriptive; terminal links expose their target.                                                                                                                                                              | A11Y-11, US-1.12                  |
| 2.4.5       | Multiple Ways                             | AA    | Intent met in-app: sidebar, next/previous shortcuts, quick switcher.                                                                                                                                                       | US-1.6, US-1.8, US-4.4            |
| 2.4.6       | Headings and Labels                       | AA    | Descriptive labels and dialog headings.                                                                                                                                                                                    | A11Y-11                           |
| 2.4.7       | Focus Visible                             | AA    | Visible focus indicator everywhere.                                                                                                                                                                                        | A11Y-06                           |
| 2.4.11      | Focus Not Obscured (Minimum)              | AA    | Overlays never fully hide the focused element.                                                                                                                                                                             | A11Y-06                           |
| 2.5.1       | Pointer Gestures                          | A     | No multipoint or path-based gestures required.                                                                                                                                                                             | A11Y-11                           |
| 2.5.2       | Pointer Cancellation                      | A     | Activation on pointer release.                                                                                                                                                                                             | A11Y-11                           |
| 2.5.3       | Label in Name                             | A     | Accessible names contain visible labels.                                                                                                                                                                                   | A11Y-09, A11Y-11                  |
| 2.5.4       | Motion Actuation                          | A     | Not applicable: no motion-triggered functions.                                                                                                                                                                             | —                                 |
| 2.5.7       | Dragging Movements                        | AA    | Keyboard and single-pointer alternatives for sidebar resize, session reorder and text selection.                                                                                                                           | A11Y-04, A11Y-11, US-1.6, US-1.10 |
| 2.5.8       | Target Size (Minimum)                     | AA    | Targets at least 24 by 24 CSS px.                                                                                                                                                                                          | A11Y-11                           |
| 3.1.1       | Language of Page                          | A     | UI language is exposed programmatically.                                                                                                                                                                                   | A11Y-11, NFR-13                   |
| 3.1.2       | Language of Parts                         | AA    | UI passages in another language are marked. Terminal output language is unknown third-party content.                                                                                                                       | A11Y-11                           |
| 3.2.1       | On Focus                                  | A     | Moving focus in the session list does not switch the terminal.                                                                                                                                                             | A11Y-11, US-1.8                   |
| 3.2.2       | On Input                                  | A     | Changing a setting never moves focus or opens a window unexpectedly.                                                                                                                                                       | A11Y-11                           |
| 3.2.3       | Consistent Navigation                     | AA    | Intent met in-app: regions and menus keep the same order everywhere.                                                                                                                                                       | A11Y-11                           |
| 3.2.4       | Consistent Identification                 | AA    | Intent met in-app: same function, same label and icon everywhere.                                                                                                                                                          | A11Y-11                           |
| 3.2.6       | Consistent Help                           | A     | Help menu and accessibility-help shortcut in the same place in every context.                                                                                                                                              | A11Y-10                           |
| 3.3.1       | Error Identification                      | A     | Errors identified in text.                                                                                                                                                                                                 | A11Y-11, US-1.3                   |
| 3.3.2       | Labels or Instructions                    | A     | All fields labeled with instructions where needed.                                                                                                                                                                         | A11Y-11                           |
| 3.3.3       | Error Suggestion                          | AA    | Every error suggests a fix.                                                                                                                                                                                                | A11Y-11, US-1.3                   |
| 3.3.4       | Error Prevention (Legal, Financial, Data) | AA    | Deleting user data (close session, remove daemon, forget host) requires confirmation.                                                                                                                                      | A11Y-11, US-1.10, US-3.3          |
| 3.3.7       | Redundant Entry                           | A     | Previously entered hosts and session settings are offered again.                                                                                                                                                           | A11Y-11, US-1.1                   |
| 3.3.8       | Accessible Authentication (Minimum)       | AA    | Key-based SSH: no passwords and no cognitive test. Host-key fingerprints are copyable for comparison.                                                                                                                      | US-1.1, US-1.2                    |
| 4.1.2       | Name, Role, Value                         | A     | Every control and the terminal expose name, role, state and value.                                                                                                                                                         | A11Y-01, A11Y-11                  |
| 4.1.3       | Status Messages                           | AA    | State changes, progress, results and errors are announced without moving focus.                                                                                                                                            | A11Y-12, A11Y-04, US-3.4          |

WCAG 2.2 removed 4.1.1 Parsing as obsolete; it is not listed.

## 11. Accessibility verification and release gates

1. **Definition of done.** An epic is done only when every global
   accessibility requirement passes the automated checks and the manual AT test
   scripts for everything the epic delivers, on every applicable cell of the AT
   matrix ([§7.3](#73-assistive-technology-matrix-p0)) for the desktop
   platforms delivered so far ([§7.4](#74-platform-delivery-order)).
2. **Automated checks in CI.**
    - axe-core with the WCAG 2.2 A and AA rule sets on every view of the
      renderer, driven through the Electron app.
    - Keyboard-only end-to-end tests for every user story.
    - Contrast checks for every built-in theme and the selection, focus and
      cursor colors.
    - Accessibility tree snapshot tests for the terminal, review mode and session
      list where the platform allows scripted inspection.
3. **Manual verification.** Scripted test passes per user story with each screen
   reader, magnifier and voice-control tool in the matrix. Platform inspectors —
   Accessibility Inspector (macOS), Accessibility Insights for Windows,
   Accerciser (Linux) — confirm role, name, state, selection and caret for the
   terminal and review mode.
4. **User research.** Usability sessions with screen reader, magnifier and
   voice-control users on each desktop platform in the epic that first delivers
   it (E1 macOS, E6 Windows, E7 Linux). Target: each core task (create a
   session, run a command and read its output, copy output, switch sessions,
   recover after a disconnect where delivered) completed unaided by at least 90%
   of participants.
5. **Conformance report.** An Accessibility Conformance Report (VPAT 2.5, WCAG
   edition) is published with each epic's release, covering the platforms
   delivered so far.
   **E1 note:** E1 defers items 4 and 5. E1 is done when the automated checks
   (item 2) pass and the owner completes the manual passes (item 3). The
   usability sessions and the first conformance report happen before any build
   is distributed beyond the owner.
6. **Release gate.** No open high-severity accessibility defect. Every WCAG 2.2
   A and AA criterion passes or is documented as not applicable with rationale.

## 12. Out of scope for P0

| Item                                                        | Notes                                    |
| ----------------------------------------------------------- | ---------------------------------------- |
| Windows remote hosts (OpenSSH Server on Windows)            | Candidate for P1.                        |
| Password and keyboard-interactive SSH authentication        | Not planned.                             |
| Split panes, tabs and multiple windows                      | Candidate for P1.                        |
| Automatic restart policies (restart on exit or failure)     | Candidate for P1. P0 has manual restart. |
| Per-session resource metrics (CPU, memory)                  | Candidate for P1.                        |
| Command-line client to list and attach sessions             | Candidate for P1.                        |
| File transfer, port-forwarding UI, SSH configuration editor | Not planned for P1.                      |
| Sharing sessions with other OS users                        | Not planned.                             |
| Mobile and web clients; settings sync across computers      | Not planned for P1.                      |
| Importing existing tmux or screen sessions                  | Not planned.                             |
| Serial, telnet and mosh connections                         | Not planned.                             |
| Right-to-left UI localization                               | After P0 localization work.              |

## 13. Risks and required spikes

| ID  | Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Mitigation                                                                                                                                                                                                                                                                                                                                                                     | Retired by                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| R1  | **OS-visible selection (A11Y-04).** Terminal libraries such as xterm.js draw their own selection over a canvas or GPU surface. The OS sees no selected text. Which selection attributes Chromium exposes for read-only text (on macOS, text markers rather than `AXSelectedTextRange`) is unconfirmed.                                                                                                                                                           | Spike at the start of E1: mirror the terminal selection into a real selection on accessible text that Chromium exposes to each platform API. Record the attribute mapping per OS, and verify Speak Selection and each screen reader's selection command on every matrix cell as each platform arrives.                                                                         | E1 (macOS); re-verified in E6, E7    |
| R2  | **Accessible text layer performance.** A parallel text layer for AT must track a fast-changing grid and a large scrollback without slowing rendering or flooding the accessibility tree.                                                                                                                                                                                                                                                                         | Spike at the start of E1: virtualize the text layer, batch updates, and measure against NFR-03 and NFR-04 with each screen reader running.                                                                                                                                                                                                                                     | E1; re-verified in E6, E7            |
| R3  | **Linux AT detection.** Chromium's detection of a running AT on Linux is less reliable than on macOS and Windows.                                                                                                                                                                                                                                                                                                                                                | Manual toggle and command-line flag (A11Y-10); test Orca on Wayland and X11.                                                                                                                                                                                                                                                                                                   | E7                                   |
| R4  | **Daemon crash or upgrade without session loss (US-2.5).** Replacing the process that holds PTYs ends sessions unless PTY ownership is separated from the upgradable component. Separation alone is not enough: on stop or restart, systemd kills every process in the unit's control group (`KillMode=control-group`), launchd kills the job's process group unless `AbandonProcessGroup` is set, and on Windows a ConPTY's processes end when its owner exits. | Spike at the start of E2: isolate each session's PTY in a long-lived holder process outside the daemon's kill scope on each OS (for example a separate systemd scope or unit, a separate process group with `AbandonProcessGroup`, a ConPTY owner independent of the daemon core). Alternatively, hand PTY file descriptors across the upgrade. Prove it with the US-2.5 test. | E2 (Linux), E5 (macOS), E6 (Windows) |
| R5  | **Process lifetime on each OS.** Windows job objects can end child processes with the app; Linux logout can end user processes (`KillUserProcesses`); macOS LaunchAgents start only at GUI login.                                                                                                                                                                                                                                                                | Launch the daemon through the OS service manager, never as an app child (SEC-07). State reduced guarantees in the UI (US-2.4, US-7.2).                                                                                                                                                                                                                                         | E2 (Linux), E5 (macOS), E6 (Windows) |
| R6  | **Linux hosts without lingering.** Without lingering, systemd stops the user's service manager and every user unit about 10 seconds (`UserStopDelaySec`) after the last login session ends. That would kill a daemon run as a user unit at SSH disconnect. Enabling lingering may need administrator approval. With `KillUserProcesses=yes`, even a detached daemon dies at logout.                                                                              | Detached daemon outside the user's systemd instance when lingering is unavailable; respawn after reboot on the app's next connection (US-3.1); a clear warning on hosts where sessions cannot persist (US-2.4).                                                                                                                                                                | E2                                   |
| R7  | **Remote macOS without a GUI login** cannot load a LaunchAgent and does not start one after reboot.                                                                                                                                                                                                                                                                                                                                                              | Detached daemon started over SSH; respawn on the app's next connection (US-5.5).                                                                                                                                                                                                                                                                                               | E5                                   |
| R8  | **ConPTY output** on Windows can repaint regions, producing noisy or duplicated announcements.                                                                                                                                                                                                                                                                                                                                                                   | Announcement diffing on logical lines (A11Y-02); dedicated Windows test scripts for JAWS, NVDA and Narrator.                                                                                                                                                                                                                                                                   | E6                                   |
| R9  | **Double speech** from screen-reader typing echo plus shell echo.                                                                                                                                                                                                                                                                                                                                                                                                | Suppress announcements of echoed input (A11Y-01).                                                                                                                                                                                                                                                                                                                              | E1                                   |
| R10 | **Restrictive remote hosts** (home directory mounted `noexec`, quotas, SELinux policies).                                                                                                                                                                                                                                                                                                                                                                        | Configurable install location per host and specific error messages (US-1.4).                                                                                                                                                                                                                                                                                                   | E1                                   |

## 14. Open questions

| ID   | Question                                                                                                                                 | Resolution                                                                                                                                                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-1 | Should persisted scrollback be encrypted at rest, with the key held in the OS keychain or credential store?                              | No. User-only permissions (SEC-05) are the control. [TECH_STACK.md](TECH_STACK.md) D-05.                                                                                                                                                                       |
| OQ-2 | Which language and runtime produce the daemon as a small, self-contained binary for every target OS and architecture? (Design decision.) | Rust: static musl binaries on Linux, universal2 on macOS, MSVC on Windows. [TECH_STACK.md](TECH_STACK.md) D-01.                                                                                                                                                |
| OQ-3 | What are the distribution channels and update mechanism for the desktop app on each OS?                                                  | macOS: signed downloads from GitHub Releases in E1–E2; automatic updates through Electron's built-in updater from E3 (US-3.4). Windows (E6) and Linux (E7) mechanisms are chosen in those epics within SEC-01 and SEC-07. [TECH_STACK.md](TECH_STACK.md) D-06. |
| OQ-4 | Does the product collect any telemetry? If yes, it must be opt-in and exclude terminal content.                                          | No telemetry and no crash uploads in P0. [TECH_STACK.md](TECH_STACK.md) D-09.                                                                                                                                                                                  |
| OQ-5 | What is the final product name?                                                                                                          | Resolved: Terminal Remote Control, TRC for short (owner, M1).                                                                                                                                                                                                  |
| OQ-6 | Which shell integration sequences beyond OSC 133 (for example VS Code's OSC 633) should the app read?                                    | Open. OSC 133 and OSC 7 are read in any case.                                                                                                                                                                                                                  |

## 15. References

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [Understanding WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/)
- [WCAG2ICT: Applying WCAG 2.2 to non-web ICT](https://www.w3.org/TR/wcag2ict-22/)
- [VPAT (ITI)](https://www.itic.org/policy/accessibility/vpat)
- [Electron accessibility](https://www.electronjs.org/docs/latest/tutorial/accessibility)
- [xterm.js](https://github.com/xtermjs/xterm.js)
- [VS Code terminal shell integration](https://code.visualstudio.com/docs/terminal/shell-integration)

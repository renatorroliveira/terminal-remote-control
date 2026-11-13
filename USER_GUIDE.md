# Terminal Remote Control user guide

Terminal Remote Control (TRC) runs terminal sessions on your Linux hosts and shows them in one accessible macOS
window. The sessions belong to a small daemon, `trcd`, that the app installs on each host for your user, so a
session keeps running when you quit the app or lose the network.

This guide covers version 0.1, the first milestone of Epic 1. [What's not there yet](#whats-not-there-yet) lists
what later releases add.

## Contents

- [Requirements](#requirements)
- [Install](#install)
- [Add a host](#add-a-host)
- [Connect](#connect)
- [Sessions](#sessions)
- [The terminal](#the-terminal)
- [Moving around and commands](#moving-around-and-commands)
- [Appearance](#appearance)
- [Accessibility](#accessibility)
- [Files and folders](#files-and-folders)
- [Troubleshooting](#troubleshooting)
- [What's not there yet](#whats-not-there-yet)

## Requirements

On your Mac:

- macOS on Apple silicon or Intel.
- OpenSSH 8.5 or later. The one that ships with macOS works.
- An SSH key that reaches each host, loaded in your SSH agent (`ssh-add -l` lists it). TRC never asks for
  passwords or passphrases.

On each host:

- Linux on x86_64 or arm64.
- `sshd` that accepts your key, and a POSIX shell.
- A few megabytes free in your home folder, which must allow running programs (not mounted `noexec`), and
  `sha256sum` or `shasum`. The host needs no internet access, no root or sudo, and no packages.

TRC uses your own SSH setup: `~/.ssh/config` (aliases, `ProxyCommand`, `ProxyJump`, ports, users), your agent and
your `known_hosts`. It never changes your SSH configuration or your keys. The one file it writes is
`~/.ssh/known_hosts`, and only when you trust a new host key.

## Install

1. Download the release for your Mac from the
   [Releases page](https://github.com/renatorroliveira/terminal-remote-control/releases): `TRC-<version>-mac-arm64.dmg`
   for Apple silicon, or `TRC-<version>-mac-x64.dmg` for Intel. `SHA256SUMS.txt` lists every file's checksum
   (`shasum -a 256 -c SHA256SUMS.txt`).
2. Open the dmg and drag Terminal Remote Control to Applications.
3. Open it once from Applications. Release 0.1 is ad-hoc signed, not notarized, so macOS blocks the first launch.
   Open System Settings, then Privacy & Security, and choose Open Anyway next to the message about Terminal Remote
   Control. Or, in Terminal:

    ```sh
    xattr -dr com.apple.quarantine "/Applications/Terminal Remote Control.app"
    ```

## Add a host

The sidebar's Hosts section has one field and an Add host button to its right.

1. Type the host as you would after `ssh`: an alias from your SSH config (`devbox`), or `user@host`,
   `host:port` or `user@host:port`.
2. Press Return or choose Add host.

TRC connects to the new host at once. The first time, it installs the daemon under `~/.trc` on the host, which
takes a few seconds.

### Trust a host key

When your `known_hosts` doesn't know the host yet, the host's entry shows its key type and SHA-256 fingerprint and
asks whether to trust it. Compare the fingerprint with one you got from the host's owner, then choose Trust, which
adds the key to `~/.ssh/known_hosts`, or Reject. Take as long as you need: the question never times out.

TRC refuses a host whose key changed. If you expected the change, remove the old key yourself
(`ssh-keygen -R <host>`) and connect again.

## Connect

When the app opens, it connects to every known host. A host that fails stays disconnected and shows no dialog.

Each host in the Hosts section shows its state as an icon and as text: Not connected, Connecting, Connected,
Connection failed or Disconnected. Its button connects, cancels or disconnects it.

When a connection you started fails, a dialog names the host, explains the reason (for example, the agent has no
key the host accepts, the host is unreachable, or the connection timed out) and offers the details ssh reported.
Choose OK to close it.

## Sessions

Each connected host has its own section in the Sessions list.

- **New session.** Choose the + button to the right of a host's name, labeled "New session on <host>". The
  session starts your login shell in your home folder and opens at once.
- **Collapse and expand.** Choose a host's name to hide or show its sessions.
- **Open a session.** Click it, or move to it with the arrow keys and press Return or Space. Moving through the
  list doesn't switch sessions. Home and End jump to the first and last session, and typing letters jumps to the
  next name that starts with them.
- **States.** Each session shows Starting, Running, Exited or Stopped. A session whose program failed shows its
  exit code or signal and stays in the list, so you can read its last output.
- **Ending a session.** Type `exit`, or end its program. A session that exits cleanly (code 0) leaves the list.

Sessions keep running on the host when you quit the app or the connection drops. When the app connects again, it
lists them, and opening one shows its screen as the host has it now. A host reboot ends them in this release.

## The terminal

The terminal takes every key you type, including Escape, Tab and the arrow keys, and sends it to the session. The
Command key belongs to the app.

| Action                         | Keys or gesture                                                     |
| ------------------------------ | ------------------------------------------------------------------- |
| Copy the selection             | Command-C                                                           |
| Paste                          | Command-V                                                           |
| Select text                    | Drag. Drag past the top or bottom edge to scroll; farther is faster |
| Scroll back and forward a page | Shift-Page Up and Shift-Page Down                                   |
| Look up the selected word      | Control-Command-D, or Edit, then Look Up                            |
| Speak the selection            | Edit, then Speech, then Start Speaking                              |

Programs that ask for the kitty keyboard protocol (Claude Code, Neovim, Helix and others) receive modified keys
such as Shift-Return and Control-Tab as distinct keys. Others receive the classic xterm codes.

The terminal sets `TERM=xterm-256color`, `COLORTERM=truecolor` and `TERM_PROGRAM=trc`, and resizes the session's
PTY to fit the window.

Terminal output never touches your clipboard: programs can't read it or write to it.

## Moving around and commands

The window has three regions: the sidebar (sessions and hosts), the terminal, and the status bar at the bottom.

| Action                                       | Keys                                                  |
| -------------------------------------------- | ----------------------------------------------------- |
| Next region, previous region                 | Command-F6, Shift-Command-F6                          |
| Command palette                              | Shift-Command-P                                       |
| Show or hide the sidebar                     | Control-Command-S, or Enter on the sidebar's edge     |
| Tab moves focus out of the terminal (toggle) | Shift-Command-M                                       |
| Send the next key to the terminal            | Shift-Command-K                                       |
| Mute output announcements for this session   | Shift-Command-A                                       |
| Notifications                                | Shift-Command-N                                       |
| Actions for the focused session or host      | Shift-F10, the Menu key, Control-click or right-click |

- **Regions.** Moving to a region puts you back where you were in it. A hidden sidebar is skipped.
- **Tab focus mode.** The terminal normally sends Tab to the shell. With Tab focus mode on, Tab and Shift-Tab
  leave the terminal like in any other field. The status bar shows the mode, and TRC says which way Tab goes.
- **Send next key.** After Shift-Command-K, the next key goes to the program even if it is an app shortcut.
- **Command palette.** Type part of a name, then press Return. The palette lists every command with its shortcut,
  every host action (connect, disconnect, new session) and every session to open. Escape closes it.
- **Status bar.** It shows the open session's host and its connection, the daemon version on that host, the Tab
  focus mode and mute buttons, and how many notifications are waiting.
- **Notifications.** Connection failures and lost connections stay in the list until you dismiss them, including
  failures while connecting at launch. TRC also says when a host connects or its connection is lost.
- **Menus.** View and Terminal hold the same commands, with their Command shortcuts.

## Appearance

- **Theme.** View, then Theme: Midnight (the default, black with green, high contrast), System (follows macOS
  light or dark), Light, Dark, High contrast light and High contrast dark. TRC also follows the macOS Increase
  contrast and Reduce motion settings.
- **Size.** View, then Zoom In (Command-Plus), Zoom Out (Command-Minus) and Actual Size (Command-0). The text
  grows or shrinks, and the session resizes to fit.
- **Sidebar width.** Drag the sidebar's right edge, between 300 and 800 pixels. Or focus the edge with Tab and use
  Left and Right (10 pixels per press), Home (narrowest) and End (widest); Enter hides the sidebar and shows it
  again. TRC remembers the width and whether the sidebar is hidden.

## Accessibility

- **VoiceOver** reads the terminal as a text field holding the screen's text, by character, word or line. The
  text field's cursor is the terminal's cursor, so VoiceOver and Zoom follow it as you type.
- **Selection** in the terminal is real text selection, so Speak Selection, Look Up and Services work on it.
- **Keyboard.** Every control works with the keyboard, with a visible focus ring, and the terminal never traps
  focus: Command-F6 always leaves it, and Tab focus mode lets Tab leave it too.
- **Announcements.** Status changes, such as Tab focus mode or a host connecting, are spoken without moving focus.
- **Voice Control** can choose every button by its name, for example "Click New session on devbox".
- **Fonts.** TRC embeds Atkinson Hyperlegible Next for the interface and Intel One Mono for the terminal.

## Files and folders

On your Mac, TRC keeps its settings in the TRC home, `~/.trc`:

| File          | Holds                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| `config.json` | `theme` (`midnight`, `system`, `light`, `dark`, `hc-light` or `hc-dark`) and `sidebarWidth` (300 to 800) |
| `hosts.json`  | The known hosts                                                                                          |

Both files are readable only by you. Edit `config.json` while the app is closed; a value TRC can't use falls back
to its default.

To use another folder, set `TRC_HOME` when you start the app. A leading `~` means your home folder, and a relative
path lies under it:

```sh
TRC_HOME=~/work/trc open -n "/Applications/Terminal Remote Control.app"
```

Logs and Chromium's own data stay in `~/Library/Application Support/Terminal Remote Control`. Logs never hold
terminal output, keystrokes, environment values or keys.

On each host, the daemon lives in `~/.trc`: its binaries under `versions/`, its socket under `run/` and its logs.
To remove TRC from a host, end its sessions, then delete `~/.trc` there.

## Troubleshooting

| The dialog says                                      | What to do                                                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| No SSH agent is running, or your agent holds no keys | Start `ssh-agent` and add your key with `ssh-add`, then connect again.                         |
| Your key needs its passphrase, or its PIN            | Add the key with `ssh-add`, which asks for it, then connect again.                             |
| The host refused every key ssh offered               | Check that `ssh <host>` works in Terminal without a password.                                  |
| The host couldn't be found, or didn't answer         | Check the name, your network or VPN, and any `ProxyCommand` or `ProxyJump` your config needs.  |
| The host key has changed                             | Ask the host's administrator. Only if the new fingerprint matches, run `ssh-keygen -R <host>`. |
| The host runs a newer daemon than this app           | Another Mac installed a newer TRC on this host. Update the app.                                |
| The daemon couldn't be installed                     | Check free space and permissions in `~/.trc` on the host, and that home isn't `noexec`.        |

If the app doesn't open after you download it, see [Install](#install), step 3.

`ssh -G <host>` shows the settings ssh will use for a host, and `ssh -v <host>` shows each connection step.

## What's not there yet

Later releases of Epic 1 add:

- Renaming, stopping, restarting, reordering and closing sessions from the app, and a dialog to pick the shell,
  folder and environment of a new session.
- Changing shortcuts, and plain F6 to move between regions, in the settings page.
- Spoken announcements of new output (the mute button is ready for them), a review mode to read the scrollback,
  and Find.
- Links, paste confirmation, the settings page, accessibility help (Option-F1) and the in-app guide (the Help
  menu items do nothing yet).
- Reconnecting after a network loss with a single action.

Later epics add sessions that survive a host reboot, local sessions on the Mac, macOS hosts, and the Windows and
Linux apps. [The PRD](docs/PRD.md) has the full plan.

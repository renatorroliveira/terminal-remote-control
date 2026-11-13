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
- A few megabytes free in your home folder, or in another folder you choose, that allows running programs (not
  mounted `noexec`), and `sha256sum` or `shasum`. The host needs no internet access, no root or sudo, and no packages.

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

The sidebar's Hosts section has the New host field, with Add host to its right, and an optional User field below.

1. Type the host as you would after `ssh`: an alias from your SSH config (`devbox`), or `user@host`,
   `host:port` or `user@host:port`. As you type, TRC offers hosts you added before and the `Host` entries of your
   `~/.ssh/config` and the files it includes; press Down Arrow to pick one.
2. To log in as another user, type it in User, or put it in the host as `user@host` (not both).
3. Press Return or choose Add host.

TRC connects to the new host at once. The first time, it installs the daemon under `~/.trc` on the host, which
takes a few seconds; each step shows in the host's state and is announced.

### Trust a host key

When your `known_hosts` doesn't know the host yet, a dialog shows the host, its key type and the SHA-256
fingerprint in a field you can select and copy. Compare it with one you got from the host's owner, then choose
Trust, which adds the key to `~/.ssh/known_hosts`, or Reject (or press Escape). Take as long as you need: the
question never times out.

TRC refuses a host whose key changed. If you expected the change, remove the old key yourself
(`ssh-keygen -R <host>`) and connect again.

### Host actions

Open a host's actions with Shift-F10, the Menu key or Control-click on it in the Hosts list or the Sessions list, or
find them in the command palette:

- **New session**, **Connect**, **Disconnect** or **Cancel connecting**.
- **Test connection**: connects, says whether it works, and disconnects again.
- **Change install location**: for a host whose home folder can't run programs (mounted `noexec`), pick another
  folder, such as one on another disk. The next connection uses it.
- **Forget**: removes the host from TRC after you confirm. Its sessions keep running on the host, and adding the host
  again shows them.

## Connect

When the app opens, it connects to every known host. A host that fails stays disconnected and shows no dialog.

Each host in the Hosts section shows its state as an icon and as text: Not connected, Connecting, Connected,
Connection failed or Disconnected. Its button connects, cancels or disconnects it.

If your key is a security key, TRC shows and says "Touch your security key for <host>" while ssh waits for the
touch.

When a connection you started fails, a dialog names the host, explains the reason (for example, the agent has no
key the host accepts, the host is unreachable, or the connection timed out) and offers the details ssh reported.
Choose OK to close it.

## Sessions

The Sessions list is a tree: each connected host, then its sessions. It is one stop for Tab.

| Action                                   | Keys or gesture                                           |
| ---------------------------------------- | --------------------------------------------------------- |
| Move through hosts and sessions          | Up and Down Arrow, Home, End, or type the start of a name |
| Expand or collapse a host                | Right or Left Arrow, Return, or click its name            |
| Go from a session to its host            | Left Arrow                                                |
| Open a session                           | Return, Space or click                                    |
| New session on this or the last host     | Command-T, or the + to the right of a host's name         |
| New session with a shell, folder or name | Shift-Command-T                                           |
| Next and previous session                | Shift-Command-] and Shift-Command-[                       |
| A session's or host's actions            | Shift-F10, the Menu key, Control-click or right-click     |

- **Opening.** Moving through the list doesn't switch sessions. Opening one moves focus to its terminal, and TRC
  says its name, host and state, and whether it has output you haven't seen.
- **States.** Each session shows Starting, Running, Exited (with the exit code or signal), Stopped or Failed to
  start, and "new output" while it has output you haven't seen. VoiceOver reads its position, such as "2 of 3".
- **New session with options.** Choose the host, the shell, the working folder, a name, and environment variables
  (one `NAME=value` per line; `NAME=` removes a variable).
- **Session actions.** Rename (an empty name shows the title the program sets), Stop, Restart (same shell, folder
  and environment; the scrollback stays), Duplicate (same shell and folder), Move up, Move down, and Close, which
  asks first because it deletes the session and its scrollback. You can also drag a session up or down its
  host's list. The command palette lists the open session's actions too.
- **Ending a session.** Type `exit`, or end its program. A session that exits cleanly (code 0) leaves the list;
  one that failed stays, so you can read its last output.

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
- **Spoken output.** In screen-reader mode, TRC speaks the open session's new output as it arrives, line after
  line, without moving focus:
    - It doesn't repeat what you type, which VoiceOver already echoes.
    - Sessions in the background stay silent. Shift-Command-A mutes and unmutes the open session.
    - When more than 20 lines arrive in a second, TRC stops reading line by line and, once the output pauses, says
      how many lines arrived, such as "312 lines of output".
    - In full-screen programs such as vim, less and htop, it reads the line at the cursor when the cursor moves to
      another line or that line changes.
    - Pressing any key drops the output still waiting to be spoken.
- **Screen-reader mode** turns on by itself when VoiceOver or other assistive technology starts using the app, and
  TRC says so. To force it, choose "Screen reader mode: on", "Screen reader mode: off" or "Screen reader mode:
  automatic" in the command palette (Shift-Command-P); TRC remembers the choice. For one launch, start the app
  with the flag:

    ```sh
    open -a "Terminal Remote Control" --args --screen-reader-mode=on
    ```

- **Voice Control** can choose every button by its name, for example "Click New session on devbox".
- **Fonts.** TRC embeds Atkinson Hyperlegible Next for the interface and Intel One Mono for the terminal.

## Files and folders

On your Mac, TRC keeps its settings in the TRC home, `~/.trc`:

| File          | Holds                                                                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.json` | `theme` (`midnight`, `system`, `light`, `dark`, `hc-light` or `hc-dark`), `sidebarWidth` (300 to 800), `sidebarCollapsed` (`true` or `false`) and `screenReaderMode` (`auto`, `on` or `off`) |
| `hosts.json`  | The known hosts                                                                                                                                                                              |

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
| The install location doesn't allow running programs  | Choose another install location from the host's actions, then connect again.                   |
| The daemon couldn't be installed                     | Check free space and permissions in the install location on the host.                          |

If the app doesn't open after you download it, see [Install](#install), step 3.

`ssh -G <host>` shows the settings ssh will use for a host, and `ssh -v <host>` shows each connection step.

## What's not there yet

Later releases of Epic 1 add:

- Changing shortcuts, and plain F6 to move between regions, in the settings page.
- A review mode to read the scrollback, and Find.
- Links, paste confirmation, the settings page, accessibility help (Option-F1) and the in-app guide (the Help
  menu items do nothing yet).
- Reconnecting after a network loss with a single action.

Later epics add sessions that survive a host reboot, local sessions on the Mac, macOS hosts, and the Windows and
Linux apps. [The PRD](docs/PRD.md) has the full plan.

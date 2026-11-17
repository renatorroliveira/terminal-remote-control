# Terminal Remote Control user guide

Terminal Remote Control (TRC) runs terminal sessions on your Linux hosts and shows them in one accessible macOS
window. The sessions belong to a small daemon, `trcd`, that the app installs on each host for your user, so a
session keeps running when you quit the app or lose the network.

This guide covers Epic 1, which version 0.2 completes. [What's not there yet](#whats-not-there-yet) lists
what later releases add.

## Contents

- [Requirements](#requirements)
- [Install](#install)
- [Quick start with VoiceOver](#quick-start-with-voiceover)
- [Add a host](#add-a-host)
- [Connect](#connect)
- [Sessions](#sessions)
- [The terminal](#the-terminal)
- [Moving around and commands](#moving-around-and-commands)
- [Settings](#settings)
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
your `known_hosts`. It never changes your SSH configuration or your keys. The one file it writes is your known hosts
file, the first `UserKnownHostsFile` your SSH config names (`~/.ssh/known_hosts` unless you set another), and only
when you trust a new host key.

## Install

1. Download the release for your Mac from the
   [Releases page](https://github.com/renatorroliveira/terminal-remote-control/releases): `TRC-<version>-mac-arm64.dmg`
   for Apple silicon, or `TRC-<version>-mac-x64.dmg` for Intel. `SHA256SUMS.txt` lists every file's checksum;
   with it in the same folder, `shasum -a 256 --ignore-missing -c SHA256SUMS.txt` checks that your download is
   complete and intact. It comes from the same Releases page, so it cannot show who made the files.
2. Open the dmg and drag Terminal Remote Control to Applications.
3. Open it once from Applications. 0.x releases are alpha, experimental builds: they are ad-hoc signed, not
   notarized, so macOS blocks the first launch. Signed builds start with 1.0.0.
   Open System Settings, then Privacy & Security, and choose Open Anyway next to the message about Terminal Remote
   Control. Or, in Terminal:

    ```sh
    xattr -dr com.apple.quarantine "/Applications/Terminal Remote Control.app"
    ```

## Quick start with VoiceOver

VO below means the VoiceOver keys: Control-Option, or Caps Lock if you set VoiceOver to use it.

1. Turn on VoiceOver with Command-F5, then open Terminal Remote Control. TRC notices VoiceOver, turns on
   screen-reader mode and says so.
2. Press Command-F6 until VoiceOver says "Sessions and hosts", then press Tab until it says "New host". Type a host
   as you would after `ssh`, and press Return. TRC says each step of connecting.
3. Press Command-T for a new session. Focus moves to its terminal, and VoiceOver says the session's name and host.
4. Type commands as in any terminal. TRC speaks new output as it arrives and leaves out what you type, which
   VoiceOver already echoes. Press Control to stop VoiceOver speaking; Shift-Command-A mutes the session's output.
5. To read what is on the screen, press VO-L for the line at the cursor. For everything, press Option-F2: review
   mode holds the whole scrollback as text that you read with the arrow keys and VoiceOver's usual commands.
   Escape returns to the terminal.
6. Select text in review mode with Shift and the arrow keys; VO-F6 reads the selection and Command-C copies it.
7. Command-F6 moves between the sidebar, the terminal and the status bar. In the session list, Up and Down Arrow
   move between sessions and Return opens one.
8. Option-F1 lists the shortcuts for where you are. Help, then Terminal Remote Control Help, opens this guide
   in its own window.

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
- **Details**: the connection, the daemon's version, how long it has run, how it runs (as a systemd user service or
  on its own), whether it fails to save some sessions' scrollback, and its install and log locations, which you can
  select and copy. From there:
    - **Upgrade daemon** shows when the host runs an older daemon than this app brings. TRC also upgrades an older
      daemon by itself when it connects; either way every session keeps running.
    - **Restart daemon** restarts the daemon's core. Sessions keep running, and TRC reconnects at once.
    - **Remove daemon from host…** lists the sessions that will stop and what it deletes, and asks first. It stops
      every session, then deletes the daemon's programs, the sessions' saved scrollback and its logs from the install
      location; files you put there stay. The host stays in TRC as "Daemon removed" and isn't connected again, even
      at launch, until you connect it, which installs the daemon again.
- **Change install location**: for a host whose home folder can't run programs (mounted `noexec`), pick another
  folder, such as one on another disk. The next connection uses it. Only you, or root, may be able to change that
  folder and each folder above it; a shared folder is fine only with the sticky bit, as `/var/tmp` has. TRC refuses
  a location other users could change, since they could swap the daemon it runs.
- **Forget**: removes the host from TRC, after asking what happens to its sessions: **Forget and leave sessions
  running** keeps them on the host, and adding the host again shows them; **Stop sessions, remove the daemon and
  forget** removes the daemon first, as above, and keeps the host if that fails.

## Connect

When the app opens, it connects to every known host at once. The sessions each host had when you last quit show
right away, marked Reconnecting, and you can work in any host that is back while the others reconnect. A host
that fails shows no dialog; if the network might fix the failure, TRC keeps trying, as after a lost connection.

Each host in the Hosts section shows its state as an icon and as text: Not connected, Connecting, Connected,
Reconnecting, Connection failed or Disconnected. Its button connects, cancels or disconnects it; while the host
reconnects, it tries again now, and after a failure it retries.

If your key is a security key, TRC shows and says "Touch your security key for <host>" while ssh waits for the
touch.

When a working connection drops, TRC says "Connection to <host> lost", lists it in the notifications, and
reconnects by itself: at once, then after 1, 2 and 4 seconds, then every 5 seconds for 5 minutes, then every 30
seconds. When your Mac wakes or its network changes, a host waiting to reconnect tries at once, and a connected
host is checked within 5 seconds. Your sessions keep running on the host the whole time. While TRC reconnects, the
host's sessions show Reconnecting and their terminals take no input: a key press is not sent and not kept for
later, and TRC shows and says "Reconnecting — input not sent". Once the host is back, TRC says "Reconnected to
<host>" and each open terminal picks up where it left off, with the output it missed added below what it already
showed. When a host has more missed output than it keeps, the terminal shows the session's whole buffer again
instead.

To stop TRC trying, choose Stop reconnecting to <host> in the host's context menu or the command palette; the
host's sessions then show Disconnected until you connect it. When reconnecting needs you, for example because
the agent has no key the host accepts, TRC stops trying, says why and lists it, and the host's button retries.

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
- **Where a session is.** Each session's name starts with the last two folders it's working in, such as `src/trc`,
  with your home folder shown as `~`, as in `~/src`. TRC shows it once the host has connected.
- **States.** A shape at the end of each session says its state: filled while it runs, half filled while it starts
  or its host reconnects, hollow while its host is disconnected, and a circle with a dash once it has exited,
  stopped or failed to start. Pointing at it shows the state, and VoiceOver reads it with the name: Starting,
  Running, Exited (with the exit code or signal), Stopped, Failed to start, Ended by restart, Processes ended,
  Disconnected or Reconnecting. "New output" shows while it has output you haven't seen, "restored" until you open
  a session the host [restored](#after-a-restart), and "scrollback not saved" while the host can't save its
  scrollback (VoiceOver reads why with the host's name). VoiceOver also reads its position, such as "2 of 3".
- **New session with options.** Choose the host, the shell, the working folder, a name, and environment variables
  (one `NAME=value` per line; `NAME=` removes a variable). On a host whose daemon is 0.4.0 or later, two switches
  also choose whether the session is restored after a restart and whether its scrollback is saved to disk.
- **Session actions.** Rename (an empty name shows the title the program sets), Session settings… (the two
  switches above), Stop, Restart (same shell, folder and environment; the scrollback stays), Duplicate (same shell
  and folder), Move up, Move down, and Close, which asks first because it deletes the session and its scrollback,
  on the host's disk too. You can also drag a session up or down its
  host's list. The command palette lists the open session's actions too.
- **Ending a session.** Type `exit`, or end its program. A session that exits cleanly (code 0) leaves the list,
  unless you turn off "Close sessions that exit cleanly" in [Settings](#settings); one that failed stays, so you
  can read its last output.
- **Stopping.** Stop asks the program to end, then forces it after the seconds Settings sets (5 by default).

Sessions keep running on the host when you quit the app, when it crashes or is forced to quit, and when the
connection drops. When the app connects again, it lists them, and opening one shows its screen as the host has
it now, with the output they wrote while you were away. They also come back after the host restarts; see
[After a restart](#after-a-restart).

On a Linux host where your user has lingering on (`loginctl enable-linger`), the host's systemd keeps the TRC
daemon running and restarts it if it fails; elsewhere the daemon runs on its own. Either way your sessions outlive
the connection. The exception is a host that ends your processes when your last connection closes
(`KillUserProcesses=yes`) while lingering is off: its status says "Connected; programs end when its last connection
closes", and TRC warns you before the first session you create there. The sessions themselves come back the next
time TRC connects, each in a new shell below its saved scrollback (see [After a restart](#after-a-restart)), but
whatever ran in them has ended. TRC never turns lingering on for you; the host's administrator can.

The first time you quit while sessions run, TRC says that they keep running and offers Quit, Quit and Stop All
Sessions, and Cancel; it doesn't ask again. To end every session, choose Quit and Stop All Sessions… in the TRC
menu or the command palette: TRC says how many sessions on how many hosts it will stop, and names any host that
isn't connected, whose sessions keep running. Once you confirm, it stops them and quits; if a host refuses, TRC
stays open and says which.

### After a restart

The daemon saves each session's scrollback to disk on the host as it arrives, in a folder only you can read under
the install location (`~/.trc/sessions`), a couple of seconds behind the screen at most. When a restart of the
host, a logout that ends your processes, or a crash ends a session's processes while it was running, the daemon
brings the session back the next time TRC connects: the same shell, name, size, place in the list and environment,
in the folder it was last in, below its saved scrollback and a line such as "Session restored after restart on
2026-11-16 09:30:00 UTC. Previous processes ended." Only the shell starts; nothing that ran in it runs again, and
variables you exported in the shell are gone. If its folder no longer exists, it starts in your home folder and
says so. The saved scrollback is history you can read, select and copy, in review mode too; new output continues
below the line.

TRC says how many sessions each host restored, such as "devbox-1 restarted: 3 sessions restored", lists it in
Notifications, and marks each session "restored" until you open it on this Mac. Sessions you stopped or that had
exited stay in the list as they were, with their saved scrollback; one whose restore is off shows "Ended by restart"
or "Processes ended". Close or restart them when you're done.

Two switches in Session settings… choose what each session keeps; both are on for new sessions:

- **Restore after restart.** Off, the session stays ended after a restart, with its saved scrollback.
- **Save scrollback to disk.** Off, none of its output is written to disk, not even the title its programs set, so
  it comes back without scrollback. Turning it off deletes what was saved. Use it for sessions that print secrets.

Either way, the daemon keeps what bringing a session back needs beside its scrollback: its name, shell, folder,
size, place in the list and the environment variables you gave it in New Session…. Don't put secrets in those
variables.

**Clear scrollback** (Command-K, the Edit menu, the terminal's context menu or the command palette) clears the
open session's scrollback in every app that has it open and deletes the copy on disk; TRC says "Scrollback
cleared". Closing a session deletes everything saved for it. If the host can't save a session's scrollback, for
example because its disk is full, TRC says so once, the session shows "scrollback not saved", and it keeps running;
saving resumes by itself once it can.

Nothing starts the daemon when the host boots: TRC registers nothing outside the install location. The sessions
come back when TRC next connects and starts the daemon.

### Sharing a session with another computer

The app on another computer can open the same session at the same time: both see its output as it comes and both
can type. The session's size follows the computer you used last. When the other computer sets it, your terminal
shows the session at that size, and the status bar and the terminal's description say "Size set by another
client"; focus the terminal or type to take the size back. When the other computer types into the session you
have open, TRC says "Input from another client" once, until it stops typing for a few seconds.

A session started before you updated the host's daemon from 0.2.0 serves one computer at a time until you close
it. When another computer opens it, your terminal says "Opened on another client — input not sent"; open the
session again to take it back.

## The terminal

The terminal takes every key you type, including Escape, Tab and the arrow keys, and sends it to the session. The
Command key belongs to the app.

| Action                              | Keys or gesture                                                     |
| ----------------------------------- | ------------------------------------------------------------------- |
| Copy the selection                  | Command-C. Wrapped lines come out as the program printed them       |
| Paste                               | Command-V. More than one line asks first and says how many          |
| Copy, Paste, List Links and Look Up | Shift-F10, the Menu key, Control-click or right-click               |
| Clear the scrollback                | Command-K, also on disk on the host                                 |
| Select text                         | Drag. Drag past the top or bottom edge to scroll; farther is faster |
| Scroll back and forward a page      | Shift-Page Up and Shift-Page Down                                   |
| Look up the selected word           | Control-Command-D, or Edit, then Look Up                            |
| Speak the selection                 | Edit, then Speech, then Start Speaking                              |

Programs that ask for the kitty keyboard protocol (Claude Code, Neovim, Helix and others) receive modified keys
such as Shift-Return and Control-Tab as distinct keys. Others receive the classic xterm codes.

The terminal sets `TERM=xterm-256color`, `COLORTERM=truecolor` and `TERM_PROGRAM=trc`, and resizes the session's
PTY to fit the window.

Programs can't read your clipboard, and by default they can't write it either. To let a host's programs write it
(for example tmux or Neovim copying over OSC 52), turn on that host's switch in Settings, under Hosts; TRC then says
each time a program puts text on the clipboard.

A selection of more than 5,000 lines still copies whole; VoiceOver sees its first 5,000 lines, and TRC says so.
Pasting more than one line shows the text and asks first, because the shell may run each line. Programs that ask
for bracketed paste, such as bash and zsh, then wait for Return before they run anything.

When you scroll back, the terminal stays where you are while output arrives, and a "New output below" button appears
(TRC says so once). Click it, press Shift-Page Down to the end, or type to return to the bottom.

The bell never flashes: the status bar shows "Bell" for a few seconds and TRC says it, with a short tone when sound
cues are on. A session in the background
gets a "bell" badge in the session list instead, until you open it.

### Review mode and Find

Option-F2 opens review mode: the whole scrollback and screen as a read-only text field over the terminal, with the
caret on the cursor's line. VoiceOver reads it by character, word, line and paragraph, a braille display follows
the caret, and Shift with the arrow keys selects text for Command-C. Command-Up and Command-Down go to the start
and the end; output that arrives meanwhile doesn't move you, TRC says "New output" once, and Command-Down brings it
in. Option-F2 or Escape returns to the terminal; review mode never sends keys to the program.

Command-F opens Find above the terminal. Type to search, from the most recent output back; Return finds the
previous match and Shift-Return the next. Match case and Regular expression narrow it. TRC selects each match, says
"Match 3 of 17", and in review mode moves the caret to it. Escape closes Find and returns where you were.

### Links

Command-click a web address in the terminal, or a link a program prints (such as `ls --hyperlink`), to open it
with the app macOS assigns to it, such as your browser. Shift-Command-O lists the links on the screen, so you can
open one from the keyboard.

Programs decide what links say, so TRC first shows the full address and asks. When the link's text differs from
its address, the dialog says so. Choose "Always open links that start with https://example.com" to trust that
site: from then on its links open without asking. TRC keeps the trusted prefixes in `accept_urls.json` (see
[Files and folders](#files-and-folders)). Links without a site, such as `mailto:` or `file:` links, always ask.
TRC never opens `javascript:` or `data:` links.

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
| List the links on the screen                 | Shift-Command-O                                       |
| Review mode, the whole buffer as text        | Option-F2                                             |
| Find in the terminal                         | Command-F                                             |
| Clear the scrollback, on the host's disk too | Command-K                                             |
| Actions for the focused session or host      | Shift-F10, the Menu key, Control-click or right-click |

- **Regions.** Moving to a region puts you back where you were in it. A hidden sidebar is skipped.
- **Tab focus mode.** The terminal normally sends Tab to the shell. With Tab focus mode on, Tab and Shift-Tab
  leave the terminal like in any other field. The status bar shows the mode, and TRC says which way Tab goes.
- **Send next key.** After Shift-Command-K, the next key goes to the program even if it is an app shortcut.
- **Command palette.** Type part of a name, then press Return. The palette lists every command with its shortcut,
  every host action (connect, disconnect, new session) and every session to open. Escape closes it.
- **Status bar.** It shows the open session's host and its connection, the daemon version on that host, the "Tab
  moves focus" and "Mute output" switches, and the Notifications button, a bell with the number of notifications
  waiting.
- **Notifications.** Connection failures and lost connections stay in the list until you dismiss them, including
  failures while connecting at launch. TRC also says when a host connects, reconnects or loses its connection.
- **Menus.** View and Terminal hold the same commands, with their Command shortcuts.

## Settings

Command-, (or Terminal Remote Control, then Settings…) opens the settings page. Type in Search settings to show
only the settings whose name or description holds what you type; the line under the field says how many are
shown. Every change applies at once and is kept; Escape or Close returns to where you were.

| Section                  | Settings                                                                                                                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Speech and announcements | Screen-reader mode (automatic, on or off); Announcements (Detailed, or Brief, which leaves out the steps of connecting); the shortcut hint VoiceOver reads after the terminal's name; the flood threshold (5 to 100 lines a second, 20 by default) |
| Sound                    | Sound cues, off by default: short tones for the bell, a host connecting, a lost or failed connection, and typing that was not sent, each also announced or shown; their volume                                                                     |
| Terminal display         | Theme; minimum text contrast (4.5 to 1, or 7 to 1); text size; line height; letter spacing; cursor shape, bar width and blinking                                                                                                                   |
| Keyboard                 | Tab moves focus out of the terminal, from launch on; plain F6 and Shift-F6 move between regions; every command's shortcut (Change, then press the new shortcut; Reset gives the default back)                                                      |
| Sessions                 | Where new sessions start (the home folder, or the open session's folder); scrollback lines for new sessions (1,000 to 100,000); the seconds Stop waits; closing sessions that exit cleanly; asking before a paste of more than one line            |
| Hosts                    | For each host, whether its programs may write the clipboard (OSC 52)                                                                                                                                                                               |

## Appearance

- **Theme.** View, then Theme: Midnight (the default, black with green, high contrast), System (follows macOS
  light or dark), Light, Dark, High contrast light and High contrast dark. TRC also follows the macOS Increase
  contrast and Reduce motion settings.
- **Terminal text size.** Command-= makes the terminal text bigger, Command-- smaller and Command-0 returns it to
  the default, in steps of 10% from 50% to 200% (also in the Terminal menu). Every session follows, resizes to fit,
  and TRC says the new size and remembers it.
- **Cursor and spacing.** The cursor is a block that doesn't blink. Settings, under Terminal display, changes its
  shape (block, bar or underline), the bar's width (1 to 6 pixels), blinking, the line height (1 to 2) and the
  letter spacing (0 to 4 pixels). A blinking cursor stops after 5 seconds without typing, and never blinks while
  macOS Reduce motion is on.
- **Window size.** View, then Zoom In (Control-Command-=), Zoom Out (Control-Command--) and Actual Size
  (Control-Command-0) scale the whole window, sidebar included. Option-Command-= and - stay macOS Zoom's.
- **Sidebar width.** Drag the sidebar's right edge, between 300 and 800 pixels. Or focus the edge with Tab and use
  Left and Right (10 pixels per press), Home (narrowest) and End (widest); Enter hides the sidebar and shows it
  again. TRC remembers the width and whether the sidebar is hidden.

## Accessibility

- **VoiceOver** reads the terminal as a text field holding the screen's text, by character, word or line. The
  text field's cursor is the terminal's cursor, so VoiceOver and Zoom follow it as you type.
- **Selection** in the terminal is real text selection, so Speak Selection, Look Up and Services work on it.
- **Keyboard.** Every control works with the keyboard, with a visible focus ring, and the terminal never traps
  focus: Command-F6 always leaves it, and Tab focus mode lets Tab leave it too.
- **Accessibility help.** Option-F1, or Help, then Accessibility Help, lists the shortcuts for where you are (the
  terminal, review mode or the session list), then those that work everywhere, with the shortcut each command has
  now. Its User guide button opens this guide.
- **User guide.** Help, then Terminal Remote Control Help, opens this guide in a window of its own, as headings,
  lists and tables that VoiceOver reads like any web page.
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
  TRC says so. To force it, pick On or Off for Screen-reader mode in Settings, or choose "Screen reader mode: on",
  "Screen reader mode: off" or "Screen reader mode: automatic" in the command palette (Shift-Command-P); TRC
  remembers the choice. For one launch, start the app
  with the flag:

    ```sh
    open -a "Terminal Remote Control" --args --screen-reader-mode=on
    ```

- **Voice Control** can choose every button by its name, for example "Click New session on devbox".
- **Fonts.** TRC embeds Atkinson Hyperlegible Next for the interface and Intel One Mono for the terminal.

## Files and folders

On your Mac, TRC keeps its settings in the TRC home, `~/.trc`:

| File               | Holds                                                                                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.json`      | Your [settings](#settings), the screen-reader mode, the sidebar's width (`sidebarWidth`, 300 to 800) and whether it is hidden (`sidebarCollapsed`), and whether the first-quit message was shown (`quitNoticeShown`) |
| `hosts.json`       | The known hosts, and per host `allowClipboardWrites` (off unless `true`)                                                                                                                                             |
| `sessions.json`    | Each host's sessions as TRC last listed them (name, title, shell, order and state), so they show at once at the next launch. TRC rewrites it; the host's own list always wins                                        |
| `accept_urls.json` | The link prefixes you trust, as a JSON list such as `["https://github.com/myteam/"]`. A prefix matches up to a `/`, `?` or `#`, so `https://github.com` never matches `https://github.com.evil.example`              |

These files are readable only by you. Edit `config.json` while the app is closed; a value TRC can't use falls back
to its default.

To use another folder, set `TRC_HOME` when you start the app. A leading `~` means your home folder, and a relative
path lies under it:

```sh
TRC_HOME=~/work/trc open -n "/Applications/Terminal Remote Control.app"
```

Logs and Chromium's own data stay in `~/Library/Application Support/Terminal Remote Control`. Logs never hold
terminal output, keystrokes, environment values or keys.

On each host, the daemon lives in `~/.trc`: its binaries under `versions/`, its socket under `run/`, its logs, and
each session's record and saved scrollback under `sessions/`, readable only by you.

### Removing TRC by hand

Remove daemon from host, in a host's details, does all of this for you. Without the app, on a Linux host:

1. End the daemon and its sessions: `pkill -f "$HOME/.trc/versions/"` (use the host's install location if you moved
   it). If the daemon ran as a systemd user service, `systemctl --user stop 'trcd-*.service'` stops it first.
2. Delete what TRC wrote: `rm -rf ~/.trc/versions ~/.trc/sessions ~/.trc/logs ~/.trc/run ~/.trc/install.lock`, then
   `rmdir ~/.trc` if nothing else is left there. A host whose install location has a long path keeps the daemon's
   sockets in `/tmp/trc-<your user ID>` instead of `run/`; delete that folder too.

TRC registers nothing outside the install location on a host: no service file, no shell startup line and nothing
that starts at boot.

On the Mac, quit TRC, then delete the app from Applications, the TRC home (`~/.trc`, or the folder `TRC_HOME` names)
and `~/Library/Application Support/Terminal Remote Control`. The keys TRC accepted at a first connection stay in
your `~/.ssh/known_hosts`, as any ssh client's do.

The licenses of the software TRC includes are in the app, in
`Terminal Remote Control.app/Contents/Resources/notices/THIRD_PARTY_NOTICES.txt`; Electron's and Chromium's are in
`LICENSE.electron.txt` and `LICENSES.chromium.html` beside it.

## Troubleshooting

| The dialog says                                      | What to do                                                                                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| No SSH agent is running, or your agent holds no keys | Start `ssh-agent` and add your key with `ssh-add`, then connect again.                                                                                |
| Your key needs its passphrase, or its PIN            | Add the key with `ssh-add`, which asks for it, then connect again.                                                                                    |
| The host refused every key ssh offered               | Check that `ssh <host>` works in Terminal without a password.                                                                                         |
| The host couldn't be found, or didn't answer         | Check the name, your network or VPN, and any `ProxyCommand` or `ProxyJump` your config needs.                                                         |
| The host key has changed                             | Ask the host's administrator. Only if the new fingerprint matches, run `ssh-keygen -R <host>`.                                                        |
| The host runs a newer daemon than this app           | Another Mac installed a newer TRC on this host. Update the app.                                                                                       |
| The install location doesn't allow running programs  | Choose another install location from the host's actions, then connect again.                                                                          |
| Other users can change the install location          | If the folder named in the details is yours, run `chmod go-w` on it on the host; otherwise choose a location only you can change. Then connect again. |
| The daemon couldn't be installed                     | Check free space and permissions in the install location on the host.                                                                                 |

If the app doesn't open after you download it, see [Install](#install), step 3.

`ssh -G <host>` shows the settings ssh will use for a host, and `ssh -v <host>` shows each connection step.

## What's not there yet

Later epics add local sessions on the Mac, macOS hosts, and the Windows and Linux apps. [The PRD](docs/PRD.md) has the full plan.

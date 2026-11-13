# E1 manual accessibility passes (PRD §11.3)

The owner runs these passes on the release candidate before the gate (ST-21, P-13). Each pass lists what to do
and what must happen; mark it **Pass** or **Fail** with a note. A failure is a high-severity accessibility defect
unless it is cosmetic, and blocks the release (§11.6).

## Setup

1. Install the release candidate from the dry run's dmg (Apple silicon) and open it once (USER_GUIDE.md, Install).
2. Use a Linux host you can reach with keys. One you have not added before is best for the host-key pass.
3. Turn each assistive technology on only for its pass. Keep **Accessibility Inspector** (Xcode, Developer Tools)
   at hand for pass 7.

| #   | Pass                                     | Assistive technology                | Result | Notes |
| --- | ---------------------------------------- | ----------------------------------- | ------ | ----- |
| 1   | Add, trust and connect a host            | VoiceOver                           |        |       |
| 2   | Sessions: create, switch, rename, stop   | VoiceOver                           |        |       |
| 3   | Read and select terminal output          | VoiceOver, VoiceOver braille if any |        |       |
| 4   | Review mode, find, links, copy and paste | VoiceOver                           |        |       |
| 5   | Connection loss                          | VoiceOver                           |        |       |
| 6   | Help, settings and the user guide        | VoiceOver                           |        |       |
| 7   | Role, name, state, selection and caret   | Accessibility Inspector             |        |       |
| 8   | Zoom follows focus and the caret         | Zoom                                |        |       |
| 9   | Voice Control and Dictation              | Voice Control, Dictation            |        |       |
| 10  | Speak Selection and items under pointer  | Spoken Content                      |        |       |
| 11  | Keyboard only                            | Full Keyboard Access                |        |       |
| 12  | Display preferences                      | Increase Contrast, Reduce Motion, … |        |       |
| 13  | Security key touch                       | A FIDO key, if available            |        |       |
| 14  | Rebind a Command shortcut                | None                                |        |       |

## 1. Add, trust and connect a host (US-1.1, US-1.2, US-1.3, US-1.4)

1. With VoiceOver on (Command-F5), open the app. **Expect:** VoiceOver says the app turned on screen-reader mode.
2. Move to the New host field, type the start of a host from your SSH config, and pick it from the suggestions with
   the arrow keys. **Expect:** each suggestion is read, with its position.
3. Press Add host, then Connect on the host. **Expect:** the steps of connecting are read politely; for a new host,
   the host-key dialog opens with focus inside, reads the fingerprint, and lets you copy it; Accept connects.
4. Add `nobody@203.0.113.1` and connect. **Expect:** after the timeout, an error that says what failed and what to
   do, read at once, with copyable details.

## 2. Sessions (US-1.6 to US-1.10)

1. Press Command-T. **Expect:** a session opens, VoiceOver names it with its host, and focus is in the terminal.
2. Open another, then press Shift-Command-[ and Shift-Command-]. **Expect:** each switch is announced.
3. Press Command-F6 until the session list has focus; move with the arrow keys. **Expect:** each item reads its
   name, state, host, position and level; moving does not switch sessions until Return.
4. Rename one from its actions (Shift-F10), stop it, restart it, and close it. **Expect:** each change is announced,
   and closing asks first.

## 3. Read and select output (US-1.11, A11Y-01 to A11Y-04)

1. In a session, run `ls -la /etc | head -30`. **Expect:** the output is read once, without the echo of the command.
2. Run `yes | head -5000`. **Expect:** a short summary instead of 5,000 lines, and VoiceOver stays responsive.
3. Read the screen with VoiceOver's line and word commands (VO-arrow keys). **Expect:** real text, line by line.
4. Select two lines with Shift-arrows in review mode (pass 4) or by dragging, then use VoiceOver's read-selection
   command (VO-F6) and copy. **Expect:** VoiceOver reads exactly the selected text, and the clipboard holds it.
5. With a braille display, if you have one: **Expect:** the line at the caret shows in braille and routing keys move
   the review caret.
6. Run `vim` and type. **Expect:** VoiceOver reads the line at the cursor, not the whole screen, as it changes.

## 4. Review mode, find, links, copy and paste (US-1.12, US-1.13, A11Y-03)

1. Press Option-F2. **Expect:** a read-only text field with the scrollback opens at the cursor line; VoiceOver
   reads it line by line, and Command-Up and Command-Down reach the start and the end of the scrollback.
2. Press Command-F, search for a word, and press Return twice. **Expect:** each Return selects the previous match
   and VoiceOver says "Match k of N".
3. Press Escape. **Expect:** focus returns to the terminal.
4. Run `echo https://example.com`, press Shift-Command-O. **Expect:** the link list opens; choosing the link asks
   before opening it, and names the target.
5. Paste two lines (Command-V). **Expect:** a confirmation that states 2 lines; after OK, the shell gets them.

## 5. Connection loss (US-1.14)

1. With a session open, turn off Wi-Fi (or disconnect from the host's network). **Expect:** within 30 seconds the
   host and its sessions are announced as disconnected.
2. Type in the terminal. **Expect:** "Disconnected — input not sent", shown and read; nothing reaches the host.
3. Reconnect the network, then Connect. **Expect:** the session re-attaches with its scrollback.

## 6. Help, settings and the guide (A11Y-10)

1. Press Option-F1. **Expect:** accessibility help opens and lists the shortcuts for where focus is.
2. Press Command-, and type `contrast`. **Expect:** the search field reads how many settings match; Tab reaches the
   setting; changing it takes effect at once.
3. Open Help, then the user guide. **Expect:** a separate window with headings, lists and tables that VoiceOver
   navigates (VO-Command-H for headings), including the VoiceOver quick start.

## 7. Accessibility Inspector (A11Y-04, A11Y-06, §11.3)

Inspect the terminal and review mode. **Expect:**

- Terminal: role text area (AXTextArea), name "<session>, <host>", focused when it has focus, value the visible
  rows, AXSelectedText equal to a drag selection, and the insertion point on the cursor's line.
- Review mode: role text area, read-only, value the page of scrollback, the caret line as you move.
- Session list: role outline (AXOutline) with rows that report level and selection.

## 8. Zoom (A11Y-06, A11Y-07)

1. Turn on Zoom with "Follow keyboard focus" and "Follow the text cursor". Zoom in a lot.
2. Type in the terminal, then move between regions with Command-F6. **Expect:** Zoom follows the caret as you type
   and follows focus between regions.
3. Press Command-= a few times. **Expect:** terminal text grows to 200% without clipping, and the terminal still
   fits its columns to the window.

## 9. Voice Control and Dictation (A11Y-08)

1. With Voice Control on, say "Show names", then "Click New session" and "Click Settings". **Expect:** every control
   has a visible name that matches what you say.
2. In the terminal, turn on Dictation and say "echo hello". **Expect:** the text arrives at the prompt.

## 10. Spoken Content

1. Turn on Speak Selection. Select terminal text and press its shortcut (Option-Esc). **Expect:** the selection is
   spoken.
2. Turn on "Speak items under the pointer" and point at terminal rows and the session list. **Expect:** each is
   spoken.

## 11. Full Keyboard Access (A11Y-05)

1. Turn on Full Keyboard Access. Reach every control with Tab and arrow keys, starting from launch.
2. In the terminal, press Shift-Command-M (Tab moves focus), then Tab. **Expect:** focus leaves the terminal; it
   is never trapped. Command-F6 always moves between the sidebar, terminal and status bar.

## 12. Display preferences (A11Y-07)

Turn on, one at a time: Increase Contrast, Reduce Motion, Reduce Transparency, Differentiate Without Color, and dark
and light appearance. **Expect:** the app follows each at once (themes, no cursor blink or smooth scroll with
Reduce Motion), and no state is shown by color alone.

## 13. Security key touch (US-1.3.2)

With a host that needs a FIDO key (`sk-ssh-ed25519`), connect. **Expect:** "Touch your security key for <host>"
appears and is read before ssh waits; touching it connects. Skip and note "no key" if you have none.

## 14. Rebind a Command shortcut (A11Y-05.7)

Automated tests cannot press a Command chord that a menu owns (ST-18 As built), so check it here.

1. Open Settings, Shortcuts, choose Change for "Show command palette", and press Command-Option-P. **Expect:** the
   table shows the new shortcut, the View menu shows it, and pressing it opens the palette.
2. Choose Reset. **Expect:** Shift-Command-P works again.

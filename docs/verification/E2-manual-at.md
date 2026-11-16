# E2 manual accessibility passes (PRD §11.3)

The owner runs these passes on the release candidate before the gate (ST-37, P-33). They cover what E2 adds; E1's
passes (`E1-manual-at.md`) still apply to everything else. Each pass lists what to do and what must happen; mark
it **Pass** or **Fail** with a note. A failure is a high-severity accessibility defect unless it is cosmetic, and
blocks the release (§11.6).

**Result (2026-11-16):** the owner ran every pass on the published v0.3.0 build; all passed.

## Setup

1. Install the release candidate from the dry run's dmg and open it once.
2. Use a Linux host you reach with keys, with a session or two open. Keep a second Mac or a terminal with `ssh` at
   hand for passes 5 and 9. For pass 9, start those sessions with 0.2.0 before installing the release candidate.
3. Turn VoiceOver on (Command-F5) for passes 1 to 6 and 9; pass 7 uses Zoom, pass 8 the keyboard alone.

| #   | Pass                                        | Assistive technology | Result | Notes |
| --- | ------------------------------------------- | -------------------- | ------ | ----- |
| 1   | Quit, and the first-quit notice             | VoiceOver            | Pass   | 0.3.0 |
| 2   | Restore at launch                           | VoiceOver            | Pass   | 0.3.0 |
| 3   | Connection loss and reconnecting            | VoiceOver            | Pass   | 0.3.0 |
| 4   | Quit and Stop All Sessions                  | VoiceOver            | Pass   | 0.3.0 |
| 5   | A session shared with another computer      | VoiceOver            | Pass   | 0.3.0 |
| 6   | A host whose sessions end at logout, if any | VoiceOver            | Pass   | 0.3.0 |
| 7   | Zoom follows focus in the new dialogs       | Zoom                 | Pass   | 0.3.0 |
| 8   | Keyboard only through every new dialog      | Full Keyboard Access | Pass   | 0.3.0 |
| 9   | Sessions started before the upgrade         | VoiceOver            | Pass   | 0.3.0 |

## 1. Quit, and the first-quit notice (US-2.1.1, US-2.1.5)

1. With sessions running, press Command-Q. **Expect:** a dialog titled "Your sessions keep running" opens with focus
   on Quit; VoiceOver reads the title and the text, which says how to stop the sessions.
2. Press Escape. **Expect:** the dialog closes and focus returns where it was. Press Command-Q again. **Expect:** the
   app quits without the dialog, which never appears again.
3. Open the app again. **Expect:** the sessions are still there and show the output they wrote meanwhile.

## 2. Restore at launch (US-2.3)

1. Quit with sessions running, then open the app. **Expect:** the session list shows them at once as Reconnecting,
   then Running; the terminal you open shows its screen as the host has it, and typing works.
2. Turn the Mac's network off, open the app, and move through the session list. **Expect:** each session reads
   "Reconnecting"; typing in its terminal says "Reconnecting — input not sent". Turn the network on. **Expect:**
   VoiceOver says "Reconnected to <host>".

## 3. Connection loss and reconnecting (US-2.2)

1. In a terminal, run `sleep 5; echo back`, then turn the network off for a few seconds. **Expect:** VoiceOver says
   the connection was lost, or only "Reconnected to <host>" when it comes back quickly; the terminal keeps what it
   showed, adds "back", and does not read the output it missed.
2. Turn the network off for longer and open the host's context menu (Shift-F10 on its row). **Expect:** "Reconnect
   <host> now" and "Stop reconnecting to <host>" are there and do what they say; after Stop, the host's sessions
   read Disconnected.
3. Sleep the Mac with the network on, then wake it. **Expect:** the host is checked within 5 seconds and, if its
   connection did not survive the sleep, reconnects.

## 4. Quit and Stop All Sessions (US-2.1.4)

1. Choose Quit and Stop All Sessions… in the TRC menu, or in the command palette (Shift-Command-P). **Expect:** a
   confirmation that names how many sessions on how many hosts it stops, and any host that is not connected, with
   focus on Cancel.
2. Choose Stop Sessions and Quit. **Expect:** the app quits; opening it again shows the sessions Stopped or Exited.

## 5. A session shared with another computer (US-2.6)

1. Open the same session from a second computer and resize its window. **Expect:** your status bar and your
   terminal's description say "Size set by another client"; your terminal shows the session at that size.
2. Type on the second computer. **Expect:** VoiceOver says "Input from another client" once, not for every key.
3. Type in your terminal. **Expect:** the note goes away and your terminal takes its size back.

## 6. A host whose sessions end at logout (US-2.4.4)

Only with a host that has `KillUserProcesses=yes` and lingering off.

1. Connect it. **Expect:** its state reads "Connected; sessions end when its last connection closes".
2. Create a session there. **Expect:** a warning titled "Sessions on <host> end when you disconnect", focus on Create
   Session; Cancel creates nothing.

## 7. Zoom follows focus in the new dialogs

1. With Zoom on and the window zoomed in, open each dialog above. **Expect:** Zoom moves to the dialog and to each
   button as focus moves.

## 8. Keyboard only through every new dialog

1. With Full Keyboard Access on, open each dialog above and its context menu items with the keyboard alone.
   **Expect:** every button and menu item can be reached and chosen, and Escape closes each dialog.

## 9. Sessions started before the upgrade (US-2.5.3, P-27)

These sessions keep their 0.2.0 holder until they close, which serves one client at a time.

1. Open a session started with 0.2.0 and run `sleep 2; echo after-upgrade`. **Expect:** VoiceOver reads
   "after-upgrade", as in any session.
2. Open the same session from the second computer. **Expect:** VoiceOver says "Opened on another client — input not
   sent. Open the session again to take it back."; typing says it again and sends nothing.
3. Press Enter on the session's row. **Expect:** the terminal shows the session again and typing works; the second
   computer is the one told now.

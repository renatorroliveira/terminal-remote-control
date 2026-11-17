# E3 manual accessibility passes (PRD §11.3)

The owner runs these passes on the release candidate before the gate (ST-50). They cover what E3 adds; the passes
of `E1-manual-at.md` and `E2-manual-at.md` still apply to everything else. Each pass lists what to do and what must
happen; mark it **Pass** or **Fail** with a note. A failure is a high-severity accessibility defect unless it is
cosmetic, and blocks the release (§11.6).

## Setup

1. Install the release candidate from the dry run's dmg and open it once.
2. Use a Linux host you reach with keys and may restart (or whose processes you may end), with two sessions open,
   one of them in a folder such as `~/src/trc`.
3. Turn VoiceOver on (Command-F5) for passes 1 to 7; pass 8 uses Zoom, pass 9 the keyboard alone, pass 10 Voice
   Control.

| #   | Pass                                       | Assistive technology | Result | Notes |
| --- | ------------------------------------------ | -------------------- | ------ | ----- |
| 1   | Sessions restored after a restart          | VoiceOver            |        |       |
| 2   | What a session restores and saves          | VoiceOver            |        |       |
| 3   | Clear scrollback                           | VoiceOver            |        |       |
| 4   | Host details                               | VoiceOver            |        |       |
| 5   | Restart daemon                             | VoiceOver            |        |       |
| 6   | Remove daemon, and Forget host             | VoiceOver            |        |       |
| 7   | Session rows, status bar and Notifications | VoiceOver            |        |       |
| 8   | Zoom follows focus in the new dialogs      | Zoom                 |        |       |
| 9   | Keyboard only through every new dialog     | Full Keyboard Access |        |       |
| 10  | Voice Control names what it shows          | Voice Control        |        |       |

## 1. Sessions restored after a restart (US-3.1, P-42)

1. In one session run `echo before-restart`. Quit TRC, restart the host (or run `pkill -KILL -u $USER trcd` there, which ends the daemon and every session's processes at once), wait
   for it to come back, and open TRC. **Expect:** once the host connects, VoiceOver says "<host> restarted: 2
   sessions restored" (or "<host>: 2 sessions restored" when only the processes ended), and Notifications lists it.
2. Move through the session list. **Expect:** each restored session reads "<name>, Running, restored".
3. Open the first one. **Expect:** VoiceOver reads its name and state; the terminal shows "before-restart" above the
   line "Session restored after restart on <date> UTC. Previous processes ended." and a new prompt; its row no
   longer says "restored".
4. Press Option-F2. **Expect:** review mode reads the saved output and the marker line as text.
5. In a session run `mkdir -p /tmp/trc-gone && cd /tmp/trc-gone`, run `rmdir /tmp/trc-gone` in the other, and
   restart again. **Expect:** the first session, restored, says its folder no longer exists and starts in the home
   folder.

## 2. What a session restores and saves (US-3.2.1, US-3.2.2)

1. Press Shift-Command-T. **Expect:** below the environment field, the switches "Restore after restart" and "Save
   scrollback to disk" read as on, each with its description.
2. Open a session's context menu (Shift-F10) and choose Session settings…. **Expect:** a dialog "Settings for
   <name>" with focus on "Restore after restart, on"; Space turns it off and VoiceOver says so; Save closes it.
3. Restart the host as in pass 1. **Expect:** that session reads "Ended by restart" or "Processes ended" and keeps
   its saved output; the others come back.

## 3. Clear scrollback (US-3.2.3)

1. In a terminal with output, press Command-K. **Expect:** VoiceOver says "Scrollback cleared."; the scrollback is
   gone, in review mode too, and on another computer that has the session open.
2. Find Clear Scrollback in the Edit menu and in the terminal's context menu. **Expect:** both are there and do the
   same.

## 4. Host details (US-3.3.1)

1. On a host's row, press Shift-F10 and choose Details of <host>…. **Expect:** a dialog "Details of <host>"; VoiceOver
   reads the connection, daemon version, how long it has run and how it runs; focus is in the Install location
   field.
2. Select the field's text and press Command-C, then Tab to Logs. **Expect:** both are read-only, select and copy;
   the buttons read Restart daemon, Remove daemon from host… and Close (Upgrade daemon only on an older daemon).

## 5. Restart daemon (US-3.3.2)

1. Choose Restart daemon. **Expect:** VoiceOver says "Restarting the daemon on <host>." and then "Daemon restarted
   on <host>."; it never says the connection was lost.
2. Type in a session. **Expect:** it still runs, with its output intact.

## 6. Remove daemon, and Forget host (US-3.3.3, US-3.3.4)

1. In the details, choose Remove daemon from host…. **Expect:** an alert "Remove the daemon from <host>?" lists the
   running sessions and says what it deletes; focus is on Cancel.
2. Choose Remove daemon. **Expect:** VoiceOver says "Removing the daemon from <host>." then "Daemon removed from
   <host>."; the host reads "Daemon removed" and is not connected again when TRC is reopened, until you connect it.
3. Connect it, then choose Forget <host>… in its context menu. **Expect:** focus on Cancel, then "Stop sessions,
   remove the daemon and forget" and "Forget and leave sessions running", each read with its name; either forgets
   the host and moves focus to the Add host field.

## 7. Session rows, status bar and Notifications (P-48)

1. Move through the session list. **Expect:** each row reads its folder first, such as "~/src/trc bash, Running";
   type-ahead finds a session by its folder or its name.
2. Move to the status bar (Command-F6). **Expect:** "Tab moves focus" and "Mute output" read as switches, on or off;
   the Notifications button reads "Notifications <count>", for example "Notifications 2".

## 8. Zoom follows focus in the new dialogs

1. With Zoom on and the window zoomed in, open Session settings…, Details of <host>…, the Remove and Forget
   confirmations. **Expect:** Zoom moves to each dialog and to each control as focus moves.

## 9. Keyboard only through every new dialog

1. With Full Keyboard Access on, open each dialog above and the new menu items with the keyboard alone. **Expect:**
   every switch, field, button and menu item can be reached and used, and Escape closes each dialog.

## 10. Voice Control names what it shows

1. With Voice Control on, say "Show names". **Expect:** each session's name includes its folder as shown, so saying
   "Click ~/src/trc bash" (or its number) opens it; the switches in Session settings answer "Click Restore after
   restart".

# E4 manual accessibility passes (PRD §11.3)

The owner runs these passes on the release candidate before the gate (ST-60). They cover what E4 adds; the passes
of `E1-manual-at.md` to `E3-manual-at.md` still apply to everything else, and to This computer as to any host
(US-4.2.2). Each pass lists what to do and what must happen; mark it **Pass** or **Fail** with a note. A failure is
a high-severity accessibility defect unless it is cosmetic, and blocks the release (§11.6).

## Setup

1. Install the release candidate from the dry run's dmg and open it once.
2. Have a Linux host you reach with keys in the sidebar, with one session open. A second Mac with Remote Login on,
   reached with keys, is needed for pass 6 only; without one, mark pass 6 **Skipped**.
3. Turn VoiceOver on (Command-F5) for passes 1 to 7; pass 8 uses Zoom, pass 9 the keyboard alone, pass 10 Voice
   Control.

| #   | Pass                                         | Assistive technology | Result | Notes |
| --- | -------------------------------------------- | -------------------- | ------ | ----- |
| 1   | This computer, first in the sidebar          | VoiceOver            |        |       |
| 2   | A local session works as a remote one        | VoiceOver            |        |       |
| 3   | Local sessions outlive the app and daemon    | VoiceOver            |        |       |
| 4   | Logout and restart                           | VoiceOver            |        |       |
| 5   | macOS asks about a protected folder          | VoiceOver            |        |       |
| 6   | A Mac as a remote host                       | VoiceOver            |        |       |
| 7   | Command-W and the ended-session banner       | VoiceOver            |        |       |
| 8   | Zoom follows focus in the banner and dialogs | Zoom                 |        |       |
| 9   | Keyboard only through the new controls       | Full Keyboard Access |        |       |
| 10  | Voice Control names what it shows            | Voice Control        |        |       |

## 1. This computer, first in the sidebar (US-4.1, US-4.2.1)

1. Open TRC. **Expect:** the session list starts with "This computer"; on the first launch of the release
   candidate, VoiceOver announces each step of installing or upgrading its daemon and then that This computer
   connected; no step asks for an administrator password.
2. On This computer's row, press Shift-F10 and choose its details. **Expect:** the dialog reads the daemon's
   version and "As a LaunchAgent, which starts at login"; Install location reads the path of your `.trc` folder and cannot be changed;
   the context menu offers no Forget.

## 2. A local session works as a remote one (US-4.2)

1. With This computer's row selected, press Command-T. **Expect:** VoiceOver reads the new session's name, your
   login shell (zsh unless you changed it), and "This computer"; the terminal has focus.
2. Run `echo local-ok`, select it with VoiceOver's text selection, and press Command-C; press Command-F and find
   `local-ok`; press Option-F2 and read the output in review mode. **Expect:** each behaves as on a Linux host.
3. Type quickly, for example `ls -la` and Return. **Expect:** the echo keeps up with typing, with no lag heard or
   seen (NFR-01).

## 3. Local sessions outlive the app and daemon (US-4.3)

1. In a local session run `echo before-quit`. Quit TRC with Command-Q and open it again. **Expect:** the session is
   listed as Running; opening it shows "before-quit" and a prompt that takes input.
2. In Terminal run `pkill -KILL -f 'trcd core'`, then in TRC type in the local session. **Expect:** within a few
   seconds This computer reads connected again and the session keeps its output and takes input; VoiceOver says
   it reconnected, not that the session ended.

## 4. Logout and restart (US-4.4)

1. With a local session open, run `echo before-logout`, log out of macOS and log in again, and open TRC.
   **Expect:** the same session is Running and shows "before-logout"; it was not restored.
2. Restart the Mac, log in and open TRC. **Expect:** VoiceOver says "This computer restarted: 1 session restored."; the session reads "<name>, Running, restored", and its terminal shows its saved output above
   "Session restored after restart on <date> UTC. Previous processes ended."

## 5. macOS asks about a protected folder (P-66)

1. In a local session run `ls ~/Desktop`. **Expect:** macOS asks whether "trcd" may access the Desktop folder;
   VoiceOver reads the question and its buttons. Choose the button that allows it. **Expect:** the listing appears
   in the session. If macOS asks nothing, as once access was granted, mark the pass **Skipped**.

## 6. A Mac as a remote host (US-4.5)

1. Add the second Mac with Add host, by its name from your SSH config. **Expect:** the install steps are
   announced as for a Linux host, and the host connects.
2. Open its details. **Expect:** "As a LaunchAgent, which starts at login" when you are logged in to that Mac's
   desktop, else the detached daemon's text; a new session there runs your login shell on that Mac.

## 7. Command-W and the ended-session banner (US-1.10.4, US-1.10.8, US-1.10.9)

1. In a local session, press Command-W. **Expect:** the alert "Close <name>?" with focus on Cancel; Escape closes
   it and the session keeps running. The Session menu lists Close session… with Command-W.
2. In the session run `exit 3`. **Expect:** VoiceOver says "<name> ended: Exited with code 3." (or the state as the
   row reads it); a region "Session ended" above the terminal reads "This session ended: Exited with code 3." with
   the buttons Restart Session and Remove Session…; focus stays where it was.
3. Turn on Tab moves focus (Shift-Command-M), press Shift-Tab from the terminal to reach the banner's buttons,
   and choose Restart Session. **Expect:** focus moves to the terminal, the shell starts again below the scrollback,
   and the banner is gone.
4. End it again with `exit 3`, and choose Remove Session…. **Expect:** the close alert, focus on Cancel; choosing
   Close session removes the session from the list and moves focus to the list.
5. End another session and press Command-W in it. **Expect:** the same alert, and the same outcome.

## 8. Zoom follows focus in the banner and dialogs

1. With Zoom on and the window zoomed in, end a session, move to the banner's buttons, and open This computer's
   details and the close alert. **Expect:** Zoom follows each control and dialog as focus moves.

## 9. Keyboard only through the new controls

1. With Full Keyboard Access on, reach This computer's row, its context menu and details, the banner's buttons and
   the close alert with the keyboard alone. **Expect:** each can be reached and used; Escape closes each dialog;
   Command-F6 always moves focus out of the terminal and the banner (A11Y-05).

## 10. Voice Control names what it shows

1. With Voice Control on and an ended session open, say "Show names". **Expect:** "Click Restart Session" and
   "Click Remove Session" work; "Click This computer" selects This computer's row.

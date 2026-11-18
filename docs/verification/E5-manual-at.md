# E5 manual accessibility passes (PRD §11.3)

The owner runs these passes on the release candidate before the gate (ST-73). They cover what E5 adds; the passes
of `E1-manual-at.md` to `E4-manual-at.md` still apply to everything else. Each pass lists what to do and what must
happen; mark it **Pass** or **Fail** with a note. A failure is a high-severity accessibility defect unless it is
cosmetic, and blocks the release (§11.6).

## Setup

1. Install the release candidate from the dry run's dmg and open it once.
2. Have This computer and a Linux host you reach with keys in the sidebar. Use sessions started after installing
   the release candidate: one from an earlier version keeps no shell integration, even after Restart (P-82); pass 6
   uses one.
3. Turn VoiceOver on (Command-F5) for passes 1 to 9; pass 10 uses Zoom, pass 11 the keyboard alone, pass 12 Voice
   Control.

| #   | Pass                                      | Assistive technology | Result | Notes |
| --- | ----------------------------------------- | -------------------- | ------ | ----- |
| 1   | Shell integration changes nothing you see | VoiceOver            |        |       |
| 2   | Moving between commands in the terminal   | VoiceOver            |        |       |
| 3   | Moving between commands in review mode    | VoiceOver            |        |       |
| 4   | Reading, selecting and copying output     | VoiceOver            |        |       |
| 5   | A failed command, and its sounds          | VoiceOver            |        |       |
| 6   | Why commands can't be reached             | VoiceOver            |        |       |
| 7   | Events in background sessions             | VoiceOver            |        |       |
| 8   | macOS notifications                       | VoiceOver            |        |       |
| 9   | Go to session, Settings and F2            | VoiceOver            |        |       |
| 10  | Zoom follows focus in the new views       | Zoom                 |        |       |
| 11  | Keyboard only through the new controls    | Full Keyboard Access |        |       |
| 12  | Voice Control names what it shows         | Voice Control        |        |       |

## 1. Shell integration changes nothing you see (US-5.1)

1. Open a new session on This computer and one on the Linux host. **Expect:** each prompt looks and reads as it
   does in Terminal; your aliases, prompt and history work; nothing in your shell's startup files changed
   (`ls -l ~/.zshrc ~/.bashrc` shows the same dates as before).
2. Run `echo $0` and `history | tail -3`. **Expect:** the shell is your login shell, and the history holds what you
   typed.

## 2. Moving between commands in the terminal (US-5.2.1)

1. Run `echo one`, `false` and `ls`. Press Option-Command-Up three times. **Expect:** VoiceOver reads each
   command's line in turn, last first, and "Failed, exit code 1" after `false`; the terminal scrolls each to its
   top. A fourth press says "No earlier command."
2. Press Option-Command-Down. **Expect:** it reads the next command; past the last it says "No later command."
3. Type a letter. **Expect:** the terminal scrolls back to the prompt, and the next Option-Command-Up starts from
   the last command again.

## 3. Moving between commands in review mode (US-5.2.1, A11Y-03)

1. Press Option-F2, then Option-Command-Up. **Expect:** the caret moves to the last command's line, which is
   selected and read; Up and Down Arrow then read the lines around it.
2. Press Option-Command-Up again, then Escape. **Expect:** the earlier command is read; Escape returns to the
   terminal.

## 4. Reading, selecting and copying output (US-5.2.1)

1. Run `printf 'alpha\nbeta\n'` and press Option-Command-R. **Expect:** VoiceOver reads "alpha beta".
2. Press Option-Command-A. **Expect:** "Selected the last command's output, 2 lines."; VoiceOver reads the
   selection as selected text.
3. Press Option-Command-C, then paste into TextEdit. **Expect:** "Copied the last command's output, 2 lines.";
   TextEdit receives `alpha` and `beta` on two lines.
4. Run `seq 500` and press Option-Command-R. **Expect:** it starts with "Last 100 of 500 lines".

## 5. A failed command, and its sounds (US-5.2.2)

1. Run `(exit 2)`. **Expect:** after any output, VoiceOver says "Command failed, exit code 2."; the status bar shows
   "Last command failed, exit code 2".
2. In Settings, under Sound, turn Sound cues on; run `(exit 2)`, wait a second, and run `true`. **Expect:** two low
   tones for the failure; nothing for the success. Under Commands, turn on Sound when a command succeeds and run `true`.
   **Expect:** one short high tone.
3. Turn off Announce failed commands and run `false`. **Expect:** no announcement.

## 6. Why commands can't be reached (US-5.2.3)

1. In a session whose shell is `sh` (New session with options, Shell: sh), press Option-Command-Up. **Expect:**
   "Moving between commands needs shell integration, which bash, zsh and fish have and sh doesn't."; typing and
   every other command still work.
2. Run `vim`, press Option-Command-Up, then quit vim. **Expect:** "Commands can't be reached while a full-screen
   program runs."; Option-Command-R reads the output of the command before `vim`.
3. In Settings, under Hosts, turn the Linux host's Shell integration off, restart a session there, and press
   Option-Command-Up. **Expect:** the message names the host and says where to turn it back on.
4. In a session started before installing the release candidate, press Option-Command-Up. **Expect:** VoiceOver
   says the session started without shell integration and that a new session has it.

## 7. Events in background sessions (US-5.3)

1. In a session run `sleep 12; false`, then open another session before it ends. **Expect:** about 12 seconds later,
   VoiceOver says "Session <name> on <host>: command finished, exit code 1."; the first session's row reads
   "..., command finished" with an icon.
2. In a background session run `sleep 3; printf '\a'`, and in another `sleep 3; exit`. **Expect:** "...: bell." and
   "...: ended, exit code 0." (or the row's removal, with Close sessions that exit cleanly on); the rows read
   "bell" and "ended" until you open them.
3. Make several bells in one background session within a second. **Expect:** one announcement, not several.

## 8. macOS notifications (US-5.3.1, P-76)

1. In Settings, under Background sessions, turn on Notify of a long command that finishes; repeat pass 7.1.
   **Expect:** macOS asks once whether Terminal Remote Control may post notifications; after you allow it, a
   notification titled "<name> on <host>" reads "Command finished, exit code 1." and holds no output.
2. Choose the notification. **Expect:** TRC comes to the front with that session open; the Notifications list
   (Shift-Command-N) also holds the event.
3. If macOS showed nothing, note it: the in-app list still holds the event, and P-76 is reopened.

## 9. Go to session, Settings and F2 (US-5.4, P-72)

1. Press Command-P. **Expect:** VoiceOver reads "Go to session", the search field and the number of sessions.
   Type part of a host's name. **Expect:** the count is read as it changes. Down Arrow and Return open the session
   read; Escape instead returns to where you were.
2. Choose Settings at the bottom of the sidebar. **Expect:** Settings shows in the terminal's place, the search
   field has focus, and the sections list reads Appearance to Hosts, with Commands and Background sessions;
   Escape returns to the terminal.
3. In the session list, focus a session and press F2. **Expect:** the rename field opens for that session.

## 10. Zoom follows focus in the new views

1. With Zoom on and following keyboard focus, open Go to session and Settings, and move through their controls.
   **Expect:** the zoomed view follows each focused control.

## 11. Keyboard only through the new controls

1. With Full Keyboard Access on, reach every control of Settings' Commands and Background sessions sections and of
   Go to session with Tab and the arrow keys, and leave each with Escape. **Expect:** each control shows a focus
   indicator, and none traps focus.

## 12. Voice Control names what it shows

1. Say "Show names" in Settings and in Go to session. **Expect:** each switch and field is named as shown, and
   saying its name operates it.

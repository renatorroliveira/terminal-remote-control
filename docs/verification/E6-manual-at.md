# E6 manual accessibility passes, part 1 (PRD §11.3)

The owner runs these passes on a Windows release candidate. They cover what 0.7.0 adds, the Windows app against
remote hosts (US-6.1); the passes of `E1-manual-at.md` to `E5-manual-at.md` describe the same features on macOS, and
0.8.0 adds its own for This computer on Windows. Each pass lists what to do and what must happen; mark it **Pass** or
**Fail** with a note. A failure is a high-severity accessibility defect unless it is cosmetic, and blocks the release
it gates (§11.6).

**Owner, 2026-11-21 (P-88):** the automated checks gate 0.7.0 and 0.8.0; these passes run at a later gate, before
1.0.0, each with the current and the previous major version of JAWS and NVDA where it names them.

## Setup

1. Install the release candidate from the dry run's `-setup.exe`, for the PC's architecture, and open it from the
   Start menu.
2. Turn on the OpenSSH Authentication Agent and load a key that reaches a Linux host (USER_GUIDE, On Windows), and
   add that host in the sidebar.
3. Use each screen reader with its default settings, one at a time; pass 9 uses Magnifier, pass 10 the keyboard
   alone, pass 11 Voice Access, pass 12 Voice Typing.

| #   | Pass                                          | Assistive technology         | Result | Notes |
| --- | --------------------------------------------- | ---------------------------- | ------ | ----- |
| 1   | Install, first launch and screen-reader mode  | NVDA, JAWS, Narrator         |        |       |
| 2   | Connecting and the session list               | NVDA, JAWS, Narrator         |        |       |
| 3   | Typing and reading the terminal               | NVDA, JAWS, Narrator         |        |       |
| 4   | Selection, copy and paste                     | NVDA, JAWS, Narrator         |        |       |
| 5   | Review mode and Find                          | NVDA, JAWS, Narrator         |        |       |
| 6   | Menus, accessibility help and Settings        | NVDA, JAWS, Narrator         |        |       |
| 7   | Commands, background events and notifications | NVDA, JAWS, Narrator         |        |       |
| 8   | Refused shortcuts and the Ctrl+C setting      | NVDA                         |        |       |
| 9   | Magnifier follows the cursor and reads aloud  | Magnifier with read aloud    |        |       |
| 10  | Keyboard only, contrast themes and text size  | Keyboard; Windows display    |        |       |
| 11  | Voice Access names and clicks what it shows   | Voice Access                 |        |       |
| 12  | Dictation and the IME into the terminal       | Voice Typing; a Japanese IME |        |       |

## 1. Install, first launch and screen-reader mode (US-6.1, A11Y-10.2)

1. Run the installer. **Expect:** SmartScreen's warning, if it shows, is read; after Run anyway, no User Account
   Control prompt appears, and the app opens when it finishes.
2. **Expect:** the app says that screen-reader mode is on, and the screen reader reads the window title and the
   sidebar's first control.

## 2. Connecting and the session list (US-1.1, US-1.5, US-1.7)

1. Press Ctrl+F6 until the screen reader says "Sessions and hosts". Tab to the host's Connect button and press it.
   **Expect:** each connection step is announced, then that the host connected.
2. Press Ctrl+Shift+T. **Expect:** focus moves to the new session's terminal, read as an editable text field named
   with the session and host, followed by "Alt F1: accessibility help."
3. Press Ctrl+F6 back to the session list. **Expect:** Up and Down Arrow read each session with its state; Enter
   opens it; Shift+F10 and the Menu key open one menu of its actions, read with its name.

## 3. Typing and reading the terminal (A11Y-01, A11Y-02, A11Y-06)

1. Type `echo hello` and press Enter. **Expect:** the typed characters are echoed once, by the screen reader, and the
   output `hello` is spoken once, by the app.
2. Read the screen with the screen reader's line, word and character commands. **Expect:** each matches the text on
   screen, and the cursor reported is the terminal's.
3. Run `seq 1 2000`. **Expect:** after the burst the app says how many lines arrived, and a key press stops
   speech.
4. Run `htop`, then press q. **Expect:** the line at the cursor is read as it changes; the shell prompt comes back.

## 4. Selection, copy and paste (A11Y-04, A11Y-04.6, P-86)

1. Select a word with Shift and the arrow keys, and another with a double-click. **Expect:** the screen reader reads
   each selection, the double-clicked word without a trailing space.
2. Press Ctrl+Shift+C, then Ctrl+Shift+V. **Expect:** the word is pasted once. With text selected, Ctrl+C
   interrupts the shell and copies nothing.
3. Copy two lines and paste them into Notepad. **Expect:** they arrive as two lines.
4. Paste two lines into the terminal. **Expect:** the confirmation dialog is read, with the line count.

## 5. Review mode and Find (A11Y-03, US-1.13)

1. Press Alt+F2. **Expect:** review mode opens with the caret on the cursor's line; the screen reader reads the
   scrollback by line, word and character; Ctrl+Home and Ctrl+End go to the start and the end.
2. Press Ctrl+Shift+F and search for `hello`. **Expect:** "Match 1 of N" is spoken and the match selected.
3. Press Escape twice. **Expect:** focus returns to the terminal.

## 6. Menus, accessibility help and Settings (US-6.1.3, A11Y-10)

1. Press Alt, then the arrow keys. **Expect:** File, Edit, View, Terminal and Help are read with their access keys;
   each item is read with its shortcut where it has one; Escape returns focus to where it was.
2. In the terminal, type `echo one two three`, then press Alt+B, Alt+F, Alt+E, Alt+V, Alt+T and Alt+H, the menus'
   own access keys among them. **Expect:** no menu opens, and readline handles each (Alt+B and Alt+F move by word).
3. Press Alt+F1. **Expect:** the help dialog lists the Windows shortcuts, such as "Accessibility help Alt+F1".
4. Press Ctrl+,. **Expect:** Settings opens with its search field focused; Escape returns.

## 7. Commands, background events and notifications (US-5.2, US-5.3)

1. Run `false`. **Expect:** "Command failed, exit code 1." Ctrl+Up reads the command; Ctrl+Shift+R reads the last
   output.
2. Open a second session, and in the first run `sleep 12; printf '\a'`. **Expect:** the bell in the background
   session is announced, and its row reads "bell".
3. Turn on its Windows notification in Settings, under Background sessions, and repeat. **Expect:** a Windows
   notification names the session and host; choosing it opens the session.

## 8. Refused shortcuts and the Ctrl+C setting (A11Y-05.6, P-86)

1. In Settings, under Keyboard, choose Change for Find, then press Ctrl+R, Alt+B and Ctrl+Alt+F. **Expect:** each is
   refused with its reason read: the terminal's, the Meta key's and AltGr's.
2. Turn on "Ctrl+C copies when text is selected". Select a word and press Ctrl+C. **Expect:** it is copied, and the
   shell gets no interrupt; with nothing selected, Ctrl+C interrupts.

## 9. Magnifier follows the cursor and reads aloud (A11Y-04.2, A11Y-06.5, P-88)

1. Turn on Magnifier at 300% and type in the terminal. **Expect:** the magnified view follows the cursor.
2. Select a word and press Ctrl+Alt+Enter. **Expect:** Magnifier reads the selection.
3. Ctrl+Alt+click a line of output, in the terminal and in review mode. **Expect:** Magnifier reads from that point.

## 10. Keyboard only, contrast themes and text size (A11Y-05, A11Y-07, A11Y-08)

1. Without a mouse, add a host, open a session, use review mode, Find and Settings. **Expect:** focus is always
   visible, and Ctrl+F6 always leaves the terminal.
2. Set TRC's Theme to System, then turn on a contrast theme in Windows Settings, under Accessibility, Contrast
   themes. **Expect:** the app's controls and the terminal take the theme's colors, and the terminal's text stays
   legible.
3. In Windows Settings, set Text size to 150% and turn off Animation effects. **Expect:** the interface text grows, and no animation or
   cursor blink runs.

## 11. Voice Access names and clicks what it shows (A11Y-09)

1. Say "Click New session", "Click Connect" with the host's name, and "Show numbers". **Expect:** each control is
   reachable by its visible name or number.

## 12. Dictation and the IME into the terminal (A11Y-09)

1. In the terminal, press Windows+H and dictate "echo dictated". **Expect:** the text reaches the shell once.
2. With a Japanese IME, compose a word. **Expect:** the candidates appear at the terminal's cursor, and only the
   chosen word reaches the shell.

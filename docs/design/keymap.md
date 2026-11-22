# Key map (E1 macOS, E6 Windows)

This document fixes the default app shortcuts on macOS and Windows and the rules every binding follows (A11Y-05). The
defaults live in `apps/desktop/src/shared/keymap.ts`; these tables must match it.

## Rules

1. **The terminal gets every other key.** A key that is not an app shortcut goes to the process, including Tab,
   Escape and Control+letter (A11Y-05.2). Command never reaches the process, so Command shortcuts cost the
   terminal nothing.
2. **Every shortcut uses Control, Option or Command, or a function key** (A11Y-05.5). A printable key alone or
   with only Shift is never a shortcut.
3. **No control codes.** Control with a letter, `[`, `]`, `\`, `/`, Space or a digit, without Command, is the
   shell's (A11Y-05.6): Control+M is Return, Control+I is Tab and Control+[ is Escape.
4. **No screen reader or OS commands** (A11Y-05.6):
    - Control+Option is VoiceOver's modifier, so no shortcut holds both.
    - Option with a printable key types characters, so it needs Command or Control too.
    - Reserved: Command+Tab, Command+Space, Control+Space, Command+\`, Command+F5 and Option+Command+F5
      (VoiceOver and Accessibility Shortcuts), Control+F1 to F8 (keyboard navigation), Shift+Command+3, 4 and 5,
      Control+Command+Q, Option+Command+D, Option+Command+8, = and - (macOS Zoom), and the Edit, View and Window
      menus' own shortcuts (Command+Z, X, C, V, A, H, M, Q, Control+Command+F, Control+Command+D, and
      Control+Command+0, = and - for zooming the window).
5. **One command per chord.** A binding that breaks a rule, or repeats another command's chord, is refused with
   the reason, and the command keeps its default.
6. **Rebindable.** Every command in the table can be rebound from Settings, under Keyboard: Change records the
   next key press, which must follow these rules and belong to no other command, and Reset gives the default
   back. While it records, the menus give up their shortcuts so a Command chord reaches it. Shift+F10 and
   the Menu key open context menus (A11Y-11.11) and Shift+Page Up and Page Down scroll the terminal; these follow
   platform convention and are not rebindable.
7. **One dispatcher.** The renderer matches every shortcut, so "Send next key to terminal" (A11Y-05.3) can pass
   any of them to the process. The macOS menus show the Command shortcuts, which never reach the process anyway;
   commands bound to function keys or to Control or Option chords show no menu shortcut, so the menu never takes
   a key the terminal may need.

## Defaults

| Command                    | Shortcut            | Why this chord                                                                                       |
| -------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| Next region                | Command+F6          | The PRD proposed Control+F6, which macOS takes for "Move focus to floating window"                   |
| Previous region            | Shift+Command+F6    | The same, backwards                                                                                  |
| Show command palette       | Shift+Command+P     | The palette shortcut of VS Code and most editors                                                     |
| Show or hide the sidebar   | Control+Command+S   | Finder's and Xcode's sidebar shortcut                                                                |
| Tab moves focus (toggle)   | Shift+Command+M     | Free on macOS; VS Code's Control+M is Return in a terminal                                           |
| Send next key to terminal  | Shift+Command+K     | Free on macOS, next to Command+K, which clears scrollback in Terminal                                |
| Mute output announcements  | Shift+Command+A     | Free in the app; Finder's Go to Applications applies only in Finder                                  |
| Show notifications         | Shift+Command+N     | Free in the app                                                                                      |
| Accessibility help         | Option+F1           | The PRD's proposal (A11Y-10.1)                                                                       |
| New session                | Command+T           | Terminal's and every browser's new-tab shortcut                                                      |
| New session with options   | Shift+Command+T     | Beside Command+T                                                                                     |
| Next session               | Shift+Command+]     | The macOS next-tab shortcut                                                                          |
| Previous session           | Shift+Command+[     | The macOS previous-tab shortcut                                                                      |
| Close session              | Command+W           | Terminal's and every browser's close-tab shortcut, through the confirmation                          |
| Go to session              | Command+P           | VS Code's Quick Open; the app prints nothing, so Print's shortcut is free (US-5.4)                   |
| List links                 | Shift+Command+O     | O for open; free in the app (US-1.12.3)                                                              |
| Bigger terminal text       | Command+=           | The text-size shortcut of Terminal and every browser (A11Y-07.4)                                     |
| Smaller terminal text      | Command+-           | The same, smaller                                                                                    |
| Default terminal text size | Command+0           | The same, back to 100%                                                                               |
| Review mode (toggle)       | Option+F2           | The PRD's proposal, VS Code's Accessible View (A11Y-03.1)                                            |
| Find in the terminal       | Command+F           | Every app's find shortcut (US-1.13)                                                                  |
| Clear scrollback           | Command+K           | Terminal's shortcut for it (US-3.2.3)                                                                |
| Previous command           | Option+Command+Up   | Command+Up already reaches the buffer's start in review mode, so Option adds the step (US-5.2, P-77) |
| Next command               | Option+Command+Down | The same, forwards                                                                                   |
| Read last command output   | Option+Command+R    | R for read; free in the app and in macOS                                                             |
| Select last command output | Option+Command+A    | Beside Command+A, which selects all                                                                  |
| Copy last command output   | Option+Command+C    | Beside Command+C, which copies the selection                                                         |
| Open the settings          | Command+,           | The macOS Settings shortcut (A11Y-10.3)                                                              |

Plain F6 (and Shift+F6) for the regions, the Windows convention, is an option in Settings (A11Y-05.2). It is off
by default because htop and mc use F6, and a command bound to F6 keeps it.

Regions, in order: the sidebar (sessions and hosts), the terminal, and the status bar. Moving to a region focuses
the element that last had focus there, or else its first control; a hidden sidebar is skipped.

## Windows rules (E6, D-67)

The rules above hold on Windows with Windows' keys:

1. **The terminal gets every other key**, Control+letter and Alt+letter included: Alt+letter is the shell's Meta key
   (readline's Alt+B and Alt+F), so in the terminal it never opens a menu; F10 and a lone Alt press reach the menu
   bar.
2. **Every shortcut uses Ctrl or Alt, or a function key.** The Windows key is the OS's, so no shortcut uses it.
3. **No control codes.** Ctrl with a letter, digit, `[`, `]`, `\`, `/` or Space alone is the shell's, and so is
   Ctrl+Shift with 2, 6 or minus, which make `@`, `^` and `_` with Control (NUL, RS and readline's undo).
   Ctrl+Shift with any other key is free, as Windows Terminal binds its commands there.
4. **No Ctrl+Alt chord**: Ctrl+Alt is AltGr on many layouts, which types characters, and Magnifier's modifier
   (Ctrl+Alt+Enter reads the selection aloud, Ctrl+Alt+click reads from the pointer). Alt with a printable key is
   refused too (rule 1). NVDA's and JAWS' Insert and Caps Lock chords are never bindable. Reserved: Alt+F4, Alt+Tab,
   Alt+Shift+Tab, Alt+Esc, Ctrl+Esc, Ctrl+Shift+Esc (Task Manager), F10 and Shift+F10 (the menu bar and context
   menus), Alt+Shift+B and Alt+Shift+C (Voice Access's microphone), and the copy and paste keys.
5. **Copy and paste are strict (P-86):** Ctrl+Shift+C and Ctrl+Insert copy, Ctrl+Shift+V and Shift+Insert paste;
   Ctrl+C and Ctrl+V always reach the shell. "Ctrl+C copies when text is selected" is a setting, off by default,
   since a selection a screen reader or magnifier user cannot see would turn an interrupt into a copy. Every copy
   puts CRLF line breaks on the clipboard.
6. **Menus** show only Ctrl chords with a printable key, which the key encoder never sends; arrows, Tab and
   function keys stay with the renderer and "Send next key to terminal". The Edit menu's Undo, Cut and Select All
   carry no shortcut, as their Windows keys are the shell's, and the window zoom and full screen in View carry none,
   as Ctrl+= and Ctrl+- are the terminal text size's and F11 belongs to terminal programs.

## Windows defaults

| Command                    | Shortcut         | Why this chord                                                           |
| -------------------------- | ---------------- | ------------------------------------------------------------------------ |
| Next region                | Ctrl+F6          | The PRD's proposal, the Windows convention for the next pane             |
| Previous region            | Ctrl+Shift+F6    | The same, backwards                                                      |
| Show command palette       | Ctrl+Shift+P     | The palette shortcut of VS Code and Windows Terminal                     |
| Show or hide the sidebar   | Ctrl+Shift+S     | S for sidebar, as on macOS                                               |
| Tab moves focus (toggle)   | Ctrl+Shift+M     | VS Code's Ctrl+M is Return in a terminal                                 |
| Send next key to terminal  | Ctrl+Shift+K     | As on macOS                                                              |
| Mute output announcements  | Ctrl+Shift+A     | As on macOS                                                              |
| Show notifications         | Ctrl+Shift+N     | As on macOS                                                              |
| Accessibility help         | Alt+F1           | The PRD's proposal (A11Y-10.1)                                           |
| New session                | Ctrl+Shift+T     | Windows Terminal's new tab                                               |
| New session with options   | Ctrl+Shift+Space | Windows Terminal's new-tab menu                                          |
| Next session               | Ctrl+Tab         | The Windows next-tab shortcut                                            |
| Previous session           | Ctrl+Shift+Tab   | The Windows previous-tab shortcut                                        |
| Close session              | Ctrl+Shift+W     | Windows Terminal's close tab; Ctrl+W is the shell's delete-word (P-65)   |
| Go to session              | Ctrl+Shift+G     | G for go; Ctrl+P is the shell's previous command (US-5.4)                |
| List links                 | Ctrl+Shift+O     | O for open, as on macOS (US-1.12.3)                                      |
| Bigger terminal text       | Ctrl+=           | The text-size shortcut of Windows Terminal and every browser (A11Y-07.4) |
| Smaller terminal text      | Ctrl+-           | The same, smaller                                                        |
| Default terminal text size | Ctrl+Shift+0     | Ctrl+0 is a control code (rule 3), so Shift is added                     |
| Review mode (toggle)       | Alt+F2           | The PRD's proposal, VS Code's Accessible View (A11Y-03.1)                |
| Find in the terminal       | Ctrl+Shift+F     | Windows Terminal's find (US-1.13)                                        |
| Clear scrollback           | Ctrl+Shift+L     | Beside Ctrl+L, which clears the screen in a shell (US-3.2.3)             |
| Previous command           | Ctrl+Up          | VS Code's previous command (US-5.2)                                      |
| Next command               | Ctrl+Down        | VS Code's next command                                                   |
| Read last command output   | Ctrl+Shift+R     | R for read, as on macOS                                                  |
| Select last command output | Ctrl+Shift+Up    | VS Code's select-to-previous-command shortcut                            |
| Copy last command output   | Ctrl+Shift+Y     | Y for yank, a copy in vim and emacs                                      |
| Open the settings          | Ctrl+,           | The Settings shortcut of VS Code and Windows Terminal (A11Y-10.3)        |

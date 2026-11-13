# Key map (E1, macOS)

This document fixes the default app shortcuts on macOS and the rules every binding follows (A11Y-05). The
defaults live in `apps/desktop/src/shared/keymap.ts`; this table must match it.

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
6. **Rebindable.** Every command in the table can be rebound (the settings page arrives in ST-18). Shift+F10 and
   the Menu key open context menus (A11Y-11.11) and Shift+Page Up and Page Down scroll the terminal; these follow
   platform convention and are not rebindable.
7. **One dispatcher.** The renderer matches every shortcut, so "Send next key to terminal" (A11Y-05.3) can pass
   any of them to the process. The macOS menus show the Command shortcuts, which never reach the process anyway;
   commands bound to function keys or to Control or Option chords show no menu shortcut, so the menu never takes
   a key the terminal may need.

## Defaults

| Command                    | Shortcut          | Why this chord                                                                     |
| -------------------------- | ----------------- | ---------------------------------------------------------------------------------- |
| Next region                | Command+F6        | The PRD proposed Control+F6, which macOS takes for "Move focus to floating window" |
| Previous region            | Shift+Command+F6  | The same, backwards                                                                |
| Show command palette       | Shift+Command+P   | The palette shortcut of VS Code and most editors                                   |
| Show or hide the sidebar   | Control+Command+S | Finder's and Xcode's sidebar shortcut                                              |
| Tab moves focus (toggle)   | Shift+Command+M   | Free on macOS; VS Code's Control+M is Return in a terminal                         |
| Send next key to terminal  | Shift+Command+K   | Free on macOS, next to Command+K, which clears scrollback in Terminal              |
| Mute output announcements  | Shift+Command+A   | Free in the app; Finder's Go to Applications applies only in Finder                |
| Show notifications         | Shift+Command+N   | Free in the app                                                                    |
| Accessibility help         | Option+F1         | The PRD's proposal (A11Y-10.1)                                                     |
| New session                | Command+T         | Terminal's and every browser's new-tab shortcut                                    |
| New session with options   | Shift+Command+T   | Beside Command+T                                                                   |
| Next session               | Shift+Command+]   | The macOS next-tab shortcut                                                        |
| Previous session           | Shift+Command+[   | The macOS previous-tab shortcut                                                    |
| List links                 | Shift+Command+O   | O for open; free in the app (US-1.12.3)                                            |
| Bigger terminal text       | Command+=         | The text-size shortcut of Terminal and every browser (A11Y-07.4)                   |
| Smaller terminal text      | Command+-         | The same, smaller                                                                  |
| Default terminal text size | Command+0         | The same, back to 100%                                                             |
| Review mode (toggle)       | Option+F2         | The PRD's proposal, VS Code's Accessible View (A11Y-03.1)                          |
| Find in the terminal       | Command+F         | Every app's find shortcut (US-1.13)                                                |
| Open the settings          | Command+,         | The macOS Settings shortcut (A11Y-10.3)                                            |

Plain F6 for the next region, the Windows convention, becomes an option in settings (A11Y-05.2). It is off by
default because htop and mc use F6.

Regions, in order: the sidebar (sessions and hosts), the terminal, and the status bar. Moving to a region focuses
the element that last had focus there, or else its first control; a hidden sidebar is skipped.

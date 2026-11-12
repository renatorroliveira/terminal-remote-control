# S2 / S3a manual checks (owner)

Start the prototype from the repository root:

```sh
spikes/s2/node_modules/.bin/electron spikes/s2
```

Variants: add `--s2-variant=contenteditable` or `--s2-variant=readonly` to compare with the default `editcontext`.

Press **Sample text** first, then Tab to the terminal (the ATS). Record pass/fail and a note for each item.

| #   | Check                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------- |
| 1   | VoiceOver on (Cmd+F5). Tab into the terminal: VoiceOver says "spike, localhost", a text-entry role, and the hint. |
| 2   | Type `hello`: each character is echoed once (VoiceOver typing echo), not twice.                               |
| 3   | Drag-select "quick brown fox" with the mouse, then press **VO+F6** (read selected text): VoiceOver reads the selection. |
| 4   | Same selection, **Option+Esc** (Speak Selection, enable it in Settings → Accessibility → Spoken Content). It speaks the selection. |
| 5   | Same selection, **Ctrl+Cmd+D** (Look Up): the dictionary panel shows the selected word.                        |
| 6   | Same selection, app menu → **Services**: text services (e.g. "Search With Google") are enabled.               |
| 7   | Press **Flood: 1 GB**, **Stop** after 2 s (fills 10,000 lines), then **Select all (xterm)**: VO+F6 reads the start without hanging VoiceOver (note the delay). |
| 8   | Zoom on (Cmd+Option+8), "Follow keyboard focus" on: typing keeps the zoomed view on the cursor.               |
| 9   | Dictation (press Fn twice or the Dictation key): dictated words appear at the prompt once.                    |
| 10  | Japanese IME (add "Japanese – Romaji"): type `nihongo`, the candidate window appears at the cursor, commit with Return; the text appears once. |
| 11  | Press **Flood: yes** with VoiceOver on: VoiceOver stays responsive (VO+Right still moves within 1 s); **Stop** works. |
| 12  | Press **Flood: 1 GB**, then **Stop** from the keyboard: the app stays interactive.                            |
| 13  | Ctrl+F6 in the terminal moves focus to "After terminal" (no focus trap).                                      |

Send the results back in the chat (for example `1 pass, 2 pass, 3 fail: read nothing, ...`).

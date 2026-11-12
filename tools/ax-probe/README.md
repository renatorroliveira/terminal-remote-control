# ax-probe

A small Swift command-line tool that reads the macOS accessibility (AX) attributes of an app's focused element and
prints them as JSON. `pnpm test:ax` uses it to check what the operating system sees of the terminal's Accessible
Text Surface: role, name, selected text and ranges, text-marker ranges and caret bounds (PRD A11Y-04, A11Y-06).

```sh
swift build -c release --package-path tools/ax-probe
tools/ax-probe/.build/release/ax-probe trusted          # exit 0 when the Accessibility permission is granted
tools/ax-probe/.build/release/ax-probe focused <pid> 3000
```

The process that runs it needs the Accessibility permission (System Settings → Privacy & Security →
Accessibility). The probe turns on the target app's full accessibility mode, as VoiceOver does.

import { defineMessage, defineMessages } from 'react-intl';

/** The settings page itself (A11Y-10.3). */
export const settingsPageMessages = {
    ...defineMessages({
        title: { id: 'settings.title', defaultMessage: 'Settings', description: 'Title of the settings page.' },
        search: {
            id: 'settings.search',
            defaultMessage: 'Search settings',
            description: 'Label of the field that filters the settings.',
        },
        none: {
            id: 'settings.none',
            defaultMessage: 'No setting matches.',
            description: 'Shown when the search matches no setting.',
        },
        close: { id: 'settings.close', defaultMessage: 'Close', description: 'Button that closes the settings page.' },
        sections: {
            id: 'settings.sections',
            defaultMessage: 'Settings sections',
            description: 'Name of the list of settings sections.',
        },
    }),
    shown: defineMessage<{ shown: number; total: number }>({
        id: 'settings.shown',
        defaultMessage: '{shown} of {total} settings shown.',
        description: 'Status line under the search field while a search shows settings.',
    }),
    inSection: defineMessage<{ count: number; section: string }>({
        id: 'settings.inSection',
        defaultMessage: '{section}: {count, plural, one {# setting} other {# settings}}.',
        description: 'Status line under the search field while one section shows, read when a section is chosen.',
    }),
};

/** The settings page's sections. */
export const settingGroupMessages = defineMessages({
    appearance: { id: 'settings.group.appearance', defaultMessage: 'Appearance', description: 'Section.' },
    speech: { id: 'settings.group.speech', defaultMessage: 'Speech and announcements', description: 'Section.' },
    sound: { id: 'settings.group.sound', defaultMessage: 'Sound', description: 'Section.' },
    keyboard: { id: 'settings.group.keyboard', defaultMessage: 'Keyboard', description: 'Section.' },
    sessions: { id: 'settings.group.sessions', defaultMessage: 'Sessions', description: 'Section.' },
    commands: { id: 'settings.group.commands', defaultMessage: 'Commands', description: 'Section (US-5.2).' },
    background: {
        id: 'settings.group.background',
        defaultMessage: 'Background sessions',
        description: 'Section: events in sessions that are not open (US-5.3).',
    },
    hosts: { id: 'settings.group.hosts', defaultMessage: 'Hosts', description: 'Section.' },
});

/** Each setting's label. */
export const settingLabelMessages = defineMessages({
    screenReaderMode: { id: 'setting.screenReaderMode', defaultMessage: 'Screen-reader mode', description: 'Setting.' },
    verbosity: { id: 'setting.verbosity', defaultMessage: 'Announcements', description: 'Setting.' },
    hints: { id: 'setting.hints', defaultMessage: 'Shortcut hint on the terminal', description: 'Setting.' },
    floodThreshold: {
        id: 'setting.floodThreshold',
        defaultMessage: 'Lines a second before output is summarized',
        description: 'Setting.',
    },
    audioCues: { id: 'setting.audioCues', defaultMessage: 'Sound cues', description: 'Setting.' },
    audioVolume: { id: 'setting.audioVolume', defaultMessage: 'Sound cue volume, percent', description: 'Setting.' },
    theme: { id: 'setting.theme', defaultMessage: 'Theme', description: 'Setting.' },
    minimumContrast: {
        id: 'setting.minimumContrast',
        defaultMessage: 'Minimum text contrast',
        description: 'Setting.',
    },
    terminalZoom: { id: 'setting.terminalZoom', defaultMessage: 'Text size, percent', description: 'Setting.' },
    lineHeight: { id: 'setting.lineHeight', defaultMessage: 'Line height', description: 'Setting.' },
    letterSpacing: { id: 'setting.letterSpacing', defaultMessage: 'Letter spacing, pixels', description: 'Setting.' },
    cursorStyle: { id: 'setting.cursorStyle', defaultMessage: 'Cursor shape', description: 'Setting.' },
    cursorWidth: { id: 'setting.cursorWidth', defaultMessage: 'Bar cursor width, pixels', description: 'Setting.' },
    cursorBlink: { id: 'setting.cursorBlink', defaultMessage: 'Blinking cursor', description: 'Setting.' },
    plainF6: { id: 'setting.plainF6', defaultMessage: 'Plain F6 moves between regions', description: 'Setting.' },
    ctrlCCopies: {
        id: 'setting.ctrlCCopies',
        defaultMessage: 'Ctrl+C copies when text is selected',
        description: 'Setting, Windows only.',
    },
    shortcuts: { id: 'setting.shortcuts', defaultMessage: 'Shortcuts', description: 'Setting: the shortcut table.' },
    tabFocusMode: {
        id: 'setting.tabFocusMode',
        defaultMessage: 'Tab moves focus out of the terminal',
        description: 'Setting.',
    },
    newSessionFolder: {
        id: 'setting.newSessionFolder',
        defaultMessage: 'New sessions start in',
        description: 'Setting.',
    },
    scrollbackLines: { id: 'setting.scrollbackLines', defaultMessage: 'Scrollback lines', description: 'Setting.' },
    stopGraceSeconds: {
        id: 'setting.stopGraceSeconds',
        defaultMessage: 'Seconds Stop waits before forcing',
        description: 'Setting.',
    },
    autoClose: {
        id: 'setting.autoClose',
        defaultMessage: 'Close sessions that exit cleanly',
        description: 'Setting.',
    },
    pasteConfirmation: {
        id: 'setting.pasteConfirmation',
        defaultMessage: 'Ask before pasting more than one line',
        description: 'Setting.',
    },
    clipboardWrites: {
        id: 'setting.clipboardWrites',
        defaultMessage: 'Programs may write the clipboard (OSC 52)',
        description: 'Setting: one switch per host.',
    },
    shellIntegration: {
        id: 'setting.shellIntegration',
        defaultMessage: 'Shell integration',
        description: 'Setting: one switch per host.',
    },
    announceFailedCommands: {
        id: 'setting.announceFailedCommands',
        defaultMessage: 'Announce failed commands',
        description: 'Setting (US-5.2.2).',
    },
    commandSucceededCue: {
        id: 'setting.commandSucceededCue',
        defaultMessage: 'Sound when a command succeeds',
        description: 'Setting (US-5.2.2).',
    },
    commandFailedCue: {
        id: 'setting.commandFailedCue',
        defaultMessage: 'Sound when a command fails',
        description: 'Setting (US-5.2.2).',
    },
    longCommandSeconds: {
        id: 'setting.longCommandSeconds',
        defaultMessage: 'Seconds before a command counts as long',
        description: 'Setting (US-5.3.1).',
    },
    announceBackgroundBell: {
        id: 'setting.announceBackgroundBell',
        defaultMessage: 'Announce a bell',
        description: 'Setting (US-5.3.1).',
    },
    notifyBackgroundBell: {
        id: 'setting.notifyBackgroundBell',
        defaultMessage: 'Notify of a bell',
        description: 'Setting (US-5.3.1).',
    },
    announceBackgroundEnd: {
        id: 'setting.announceBackgroundEnd',
        defaultMessage: 'Announce a session that ends',
        description: 'Setting (US-5.3.1).',
    },
    notifyBackgroundEnd: {
        id: 'setting.notifyBackgroundEnd',
        defaultMessage: 'Notify of a session that ends',
        description: 'Setting (US-5.3.1).',
    },
    announceBackgroundCommand: {
        id: 'setting.announceBackgroundCommand',
        defaultMessage: 'Announce a long command that finishes',
        description: 'Setting (US-5.3.1).',
    },
    notifyBackgroundCommand: {
        id: 'setting.notifyBackgroundCommand',
        defaultMessage: 'Notify of a long command that finishes',
        description: 'Setting (US-5.3.1).',
    },
});

/** Settings' descriptions, which the search also reads. */
export const settingDescriptionMessages = defineMessages({
    screenReaderMode: {
        id: 'setting.screenReaderMode.description',
        defaultMessage:
            'Speaks new output. Automatic turns on when a screen reader or other assistive technology is in use.',
        description: 'Setting description.',
    },
    verbosity: {
        id: 'setting.verbosity.description',
        defaultMessage: 'Brief leaves out the steps of connecting to a host.',
        description: 'Setting description.',
    },
    hints: {
        id: 'setting.hints.description',
        defaultMessage: 'VoiceOver, NVDA or JAWS reads it after the terminal’s name: the accessibility help shortcut.',
        description: 'Setting description.',
    },
    audioCues: {
        id: 'setting.audioCues.description',
        defaultMessage:
            'Short tones for the bell, a host connecting, a lost or failed connection, and typing that was not sent. Each is also announced or shown.',
        description: 'Setting description.',
    },
    audioVolume: {
        id: 'setting.audioVolume.description',
        defaultMessage: 'Changing it plays the bell tone.',
        description: 'Setting description.',
    },
    minimumContrast: {
        id: 'setting.minimumContrast.description',
        defaultMessage: 'Colors programs choose are adjusted to keep at least this contrast.',
        description: 'Setting description.',
    },
    cursorBlink: {
        id: 'setting.cursorBlink.description',
        defaultMessage: 'Stops after 5 seconds without typing, and never blinks while Reduce motion is on.',
        description: 'Setting description.',
    },
    plainF6: {
        id: 'setting.plainF6.description',
        defaultMessage: 'Shift-F6 goes back. Off by default, because programs such as htop and mc use F6.',
        description: 'Setting description.',
    },
    ctrlCCopies: {
        id: 'setting.ctrlCCopies.description',
        defaultMessage:
            'Off by default, so Ctrl+C always interrupts, even with a selection you may not see. Ctrl+Shift+C and Ctrl+Insert always copy.',
        description: 'Setting description, Windows only.',
    },
    shortcuts: {
        id: 'setting.shortcuts.description',
        defaultMessage: 'Change a command’s shortcut, or reset it to the default.',
        description: 'Setting description.',
    },
    scrollbackLines: {
        id: 'setting.scrollbackLines.description',
        defaultMessage: 'For sessions created from now on, from 1,000 to 100,000.',
        description: 'Setting description.',
    },
    autoClose: {
        id: 'setting.autoClose.description',
        defaultMessage: 'A session that exits with another code or a signal always stays.',
        description: 'Setting description.',
    },
    clipboardWrites: {
        id: 'setting.clipboardWrites.description',
        defaultMessage: 'TRC says each time a program puts text on the clipboard. Programs can never read it.',
        description: 'Setting description.',
    },
    shellIntegration: {
        id: 'setting.shellIntegration.description',
        defaultMessage:
            'Bash, zsh and fish mark each prompt and command, so you can move between commands and hear when one fails. TRC changes none of your shell’s files. A change applies when a shell next starts.',
        description: 'Setting description.',
    },
    commandSucceededCue: {
        id: 'setting.commandSucceededCue.description',
        defaultMessage: 'Plays while sound cues are on, for the open session.',
        description: 'Setting description.',
    },
    commandFailedCue: {
        id: 'setting.commandFailedCue.description',
        defaultMessage: 'Plays while sound cues are on, for the open session.',
        description: 'Setting description.',
    },
    longCommandSeconds: {
        id: 'setting.longCommandSeconds.description',
        defaultMessage:
            'A command in a session that isn’t open is an event when it finishes after this long. It needs shell integration.',
        description: 'Setting description.',
    },
    notifyBackgroundBell: {
        id: 'setting.notifyBackgroundBell.description',
        defaultMessage: 'Posts a system notification for a session that isn’t open. Choosing it opens the session.',
        description: 'Setting description.',
    },
});

/** The choices of the settings that offer some. */
export const settingChoiceMessages = defineMessages({
    srAuto: { id: 'setting.choice.srAuto', defaultMessage: 'Automatic', description: 'Screen-reader mode choice.' },
    srOn: { id: 'setting.choice.srOn', defaultMessage: 'On', description: 'Screen-reader mode choice.' },
    srOff: { id: 'setting.choice.srOff', defaultMessage: 'Off', description: 'Screen-reader mode choice.' },
    detailed: { id: 'setting.choice.detailed', defaultMessage: 'Detailed', description: 'Verbosity choice.' },
    brief: { id: 'setting.choice.brief', defaultMessage: 'Brief', description: 'Verbosity choice.' },
    midnight: { id: 'setting.choice.midnight', defaultMessage: 'Midnight', description: 'Theme choice.' },
    system: { id: 'setting.choice.system', defaultMessage: 'System', description: 'Theme choice.' },
    light: { id: 'setting.choice.light', defaultMessage: 'Light', description: 'Theme choice.' },
    dark: { id: 'setting.choice.dark', defaultMessage: 'Dark', description: 'Theme choice.' },
    hcLight: { id: 'setting.choice.hcLight', defaultMessage: 'High contrast light', description: 'Theme choice.' },
    hcDark: { id: 'setting.choice.hcDark', defaultMessage: 'High contrast dark', description: 'Theme choice.' },
    contrastAa: { id: 'setting.choice.contrastAa', defaultMessage: '4.5 to 1 (WCAG AA)', description: 'Contrast.' },
    contrastAaa: { id: 'setting.choice.contrastAaa', defaultMessage: '7 to 1 (WCAG AAA)', description: 'Contrast.' },
    block: { id: 'setting.choice.block', defaultMessage: 'Block', description: 'Cursor shape choice.' },
    bar: { id: 'setting.choice.bar', defaultMessage: 'Bar', description: 'Cursor shape choice.' },
    underline: { id: 'setting.choice.underline', defaultMessage: 'Underline', description: 'Cursor shape choice.' },
    home: { id: 'setting.choice.home', defaultMessage: 'The home folder', description: 'New session folder choice.' },
    openSession: {
        id: 'setting.choice.openSession',
        defaultMessage: 'The open session’s folder',
        description: 'New session folder choice.',
    },
});

/** The shortcut table and its recorder (A11Y-05.7). */
export const shortcutMessages = {
    ...defineMessages({
        command: { id: 'shortcuts.command', defaultMessage: 'Command', description: 'Shortcut table column.' },
        shortcut: { id: 'shortcuts.shortcut', defaultMessage: 'Shortcut', description: 'Shortcut table column.' },
        actions: { id: 'shortcuts.actions', defaultMessage: 'Actions', description: 'Shortcut table column.' },
        none: { id: 'shortcuts.none', defaultMessage: 'None', description: 'A command without a shortcut.' },
        change: { id: 'shortcuts.change', defaultMessage: 'Change', description: 'Button text.' },
        reset: { id: 'shortcuts.reset', defaultMessage: 'Reset', description: 'Button text.' },
    }),
    changeLabel: defineMessage<{ command: string }>({
        id: 'shortcuts.changeLabel',
        defaultMessage: 'Change {command}',
        description: 'Accessible name of the button that records a new shortcut.',
    }),
    resetLabel: defineMessage<{ command: string }>({
        id: 'shortcuts.resetLabel',
        defaultMessage: 'Reset {command}',
        description: 'Accessible name of the button that gives a command its default shortcut back.',
    }),
    recording: defineMessage<{ command: string }>({
        id: 'shortcuts.recording',
        defaultMessage: 'Press the new shortcut for {command}, or Escape to keep it',
        description: 'The recorder, waiting for a key press.',
    }),
    set: defineMessage<{ command: string; shortcut: string }>({
        id: 'shortcuts.set',
        defaultMessage: '{command}: {shortcut}.',
        description: 'Status after a new shortcut is kept.',
    }),
    resetDone: defineMessage<{ command: string; shortcut: string }>({
        id: 'shortcuts.resetDone',
        defaultMessage: '{command}: back to {shortcut}.',
        description: 'Status after a shortcut is reset.',
    }),
    taken: defineMessage<{ command: string; shortcut: string }>({
        id: 'shortcuts.taken',
        defaultMessage: '{shortcut} is already the shortcut of {command}.',
        description: 'Status when the pressed shortcut belongs to another command.',
    }),
};

/** Why a shortcut cannot be used (docs/design/keymap.md). */
export const bindingProblemMessages = defineMessages({
    'no-modifier': {
        id: 'shortcuts.problem.noModifier',
        defaultMessage: 'A shortcut needs Control, Option or Command, or a function key.',
        description: 'Refused shortcut.',
    },
    'control-code': {
        id: 'shortcuts.problem.controlCode',
        defaultMessage: 'The terminal uses Control with that key.',
        description: 'Refused shortcut.',
    },
    'option-types': {
        id: 'shortcuts.problem.optionTypes',
        defaultMessage: 'Option with that key types a character.',
        description: 'Refused shortcut.',
    },
    'screen-reader': {
        id: 'shortcuts.problem.screenReader',
        defaultMessage: 'VoiceOver uses Control with Option.',
        description: 'Refused shortcut.',
    },
    'control-alt': {
        id: 'shortcuts.problem.controlAlt',
        defaultMessage: 'Ctrl with Alt types characters on many keyboards, and Magnifier uses it.',
        description: 'Refused shortcut on Windows.',
    },
    reserved: {
        id: 'shortcuts.problem.reserved',
        defaultMessage: 'macOS, VoiceOver or a menu already uses that shortcut.',
        description: 'Refused shortcut.',
    },
});

/** Why a shortcut cannot be used on Windows, where the keys and their owners differ (docs/design/keymap.md). */
export const windowsBindingProblemMessages = defineMessages({
    'no-modifier': {
        id: 'shortcuts.problem.windows.noModifier',
        defaultMessage: 'A shortcut needs Ctrl or Alt, or a function key.',
        description: 'Refused shortcut on Windows.',
    },
    'control-code': {
        id: 'shortcuts.problem.windows.controlCode',
        defaultMessage: 'The terminal uses Ctrl with that key.',
        description: 'Refused shortcut on Windows.',
    },
    'option-types': {
        id: 'shortcuts.problem.windows.altTypes',
        defaultMessage: 'Alt with that key is the terminal’s Meta key and opens menus.',
        description: 'Refused shortcut on Windows.',
    },
    'screen-reader': {
        id: 'shortcuts.problem.windows.screenReader',
        defaultMessage: 'A screen reader uses that shortcut.',
        description: 'Refused shortcut on Windows.',
    },
    'control-alt': {
        id: 'shortcuts.problem.windows.controlAlt',
        defaultMessage: 'Ctrl with Alt types characters on many keyboards, and Magnifier uses it.',
        description: 'Refused shortcut on Windows.',
    },
    reserved: {
        id: 'shortcuts.problem.windows.reserved',
        defaultMessage: 'Windows, a screen reader or a menu already uses that shortcut.',
        description: 'Refused shortcut on Windows.',
    },
});

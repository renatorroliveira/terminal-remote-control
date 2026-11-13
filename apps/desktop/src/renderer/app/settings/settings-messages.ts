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
    }),
    shown: defineMessage<{ shown: number; total: number }>({
        id: 'settings.shown',
        defaultMessage: '{shown} of {total} settings shown.',
        description: 'Status line under the search field.',
    }),
};

/** The settings page's sections. */
export const settingGroupMessages = defineMessages({
    speech: { id: 'settings.group.speech', defaultMessage: 'Speech and announcements', description: 'Section.' },
    display: { id: 'settings.group.display', defaultMessage: 'Terminal display', description: 'Section.' },
    keyboard: { id: 'settings.group.keyboard', defaultMessage: 'Keyboard', description: 'Section.' },
    sessions: { id: 'settings.group.sessions', defaultMessage: 'Sessions', description: 'Section.' },
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
});

/** Settings' descriptions, which the search also reads. */
export const settingDescriptionMessages = defineMessages({
    screenReaderMode: {
        id: 'setting.screenReaderMode.description',
        defaultMessage: 'Speaks new output. Automatic turns on when VoiceOver or other assistive technology is in use.',
        description: 'Setting description.',
    },
    verbosity: {
        id: 'setting.verbosity.description',
        defaultMessage: 'Brief leaves out the steps of connecting to a host.',
        description: 'Setting description.',
    },
    hints: {
        id: 'setting.hints.description',
        defaultMessage: 'VoiceOver reads it after the terminal’s name: Option F1, accessibility help.',
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

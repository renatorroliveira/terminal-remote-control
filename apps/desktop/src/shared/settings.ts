import { DEFAULT_THEME_PREFERENCE, type ThemePreference } from './display';
import { type CommandId, type Keymap, resolveKeymap } from './keymap';
import { DEFAULT_TERMINAL_APPEARANCE, type TerminalAppearance } from './terminal-appearance';
import { TERMINAL_ZOOM } from './terminal-zoom';

/** How much the app announces: everything, or without the steps of connecting to a host. */
export const VERBOSITY_LEVELS = ['detailed', 'brief'] as const;

/** One announcement verbosity level (A11Y-10.3). */
export type Verbosity = (typeof VERBOSITY_LEVELS)[number];

/** The minimum contrast ratios the terminal can enforce: WCAG AA, or AAA (A11Y-04, A11Y-10.3). */
export const MINIMUM_CONTRASTS = [4.5, 7] as const;

/** One minimum contrast ratio. */
export type MinimumContrast = (typeof MINIMUM_CONTRASTS)[number];

/** Where a new session starts: the home folder, or the open session's folder (US-1.7.1). */
export const NEW_SESSION_FOLDERS = ['home', 'open-session'] as const;

/** One new-session folder rule. */
export type NewSessionFolder = (typeof NEW_SESSION_FOLDERS)[number];

/** Every preference the settings page edits, kept in `config.json` (A11Y-10.3, P-18). */
export interface Settings {
    readonly theme: ThemePreference;
    /** How much the app announces (A11Y-10.3). */
    readonly verbosity: Verbosity;
    /** Whether the terminal's description names the help and leave-terminal shortcuts (A11Y-01.2). */
    readonly hints: boolean;
    /** Lines a second above which output is summarized (A11Y-02.3). */
    readonly floodThreshold: number;
    /** The contrast the terminal keeps between text and its background (A11Y-04). */
    readonly minimumContrast: MinimumContrast;
    /** The terminal text size, in percent (A11Y-07.4). */
    readonly terminalZoom: number;
    /** How the terminal grid and cursor look (A11Y-07.6, A11Y-07.8, A11Y-08.1). */
    readonly terminalAppearance: TerminalAppearance;
    /** Whether Tab moves focus out of the terminal from launch (A11Y-05.4). */
    readonly tabFocusMode: boolean;
    /** Lines of scrollback a new session keeps (NFR-10, US-1.11.4). */
    readonly scrollbackLines: number;
    /** Seconds between Stop's signals (US-1.10.2). */
    readonly stopGraceSeconds: number;
    /** Whether a session that exits with code 0 leaves the list (US-1.10.7). */
    readonly autoClose: boolean;
    /** Whether pasting more than one line asks first (US-1.12.2). */
    readonly pasteConfirmation: boolean;
    /** Where a new session starts (US-1.7.1). */
    readonly newSessionFolder: NewSessionFolder;
    /** The user's own shortcuts, such as `Ctrl+Cmd+G`, by command (A11Y-05.7). */
    readonly shortcuts: Readonly<Partial<Record<CommandId, string>>>;
    /** Whether plain F6 and Shift+F6 also move between regions (A11Y-05.2). */
    readonly plainF6: boolean;
    /** Whether short tones play beside announcements (A11Y-12.4). */
    readonly audioCues: boolean;
    /** The sound cues' volume, in percent. */
    readonly audioVolume: number;
}

/** The ranges the numeric settings accept. */
export const SETTINGS_LIMITS = {
    floodThreshold: { min: 5, max: 100 },
    scrollbackLines: { min: 1_000, max: 100_000 },
    stopGraceSeconds: { min: 1, max: 60 },
    audioVolume: { min: 0, max: 100 },
} as const;

/** The settings of a new install. */
export const DEFAULT_SETTINGS: Settings = {
    theme: DEFAULT_THEME_PREFERENCE,
    verbosity: 'detailed',
    hints: true,
    floodThreshold: 20,
    minimumContrast: 4.5,
    terminalZoom: TERMINAL_ZOOM.initial,
    terminalAppearance: DEFAULT_TERMINAL_APPEARANCE,
    tabFocusMode: false,
    scrollbackLines: 10_000,
    stopGraceSeconds: 5,
    autoClose: true,
    pasteConfirmation: true,
    newSessionFolder: 'home',
    shortcuts: {},
    plainF6: false,
    audioCues: false,
    audioVolume: 50,
};

/** The keymap the settings put in force: the user's shortcuts, and plain F6 when on (A11Y-05.2, A11Y-05.7). */
export function keymapFor(settings: Pick<Settings, 'shortcuts' | 'plainF6'>): Keymap {
    return resolveKeymap(settings.shortcuts, { plainF6: settings.plainF6 });
}

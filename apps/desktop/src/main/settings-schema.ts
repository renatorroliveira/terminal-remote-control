import { z } from 'zod';
import { COMMAND_IDS } from '../shared/keymap';
import {
    SETTINGS_LIMITS as LIMITS,
    MINIMUM_CONTRASTS,
    NEW_SESSION_FOLDERS,
    type Settings,
    VERBOSITY_LEVELS,
} from '../shared/settings';
import {
    TERMINAL_APPEARANCE_LIMITS as APPEARANCE,
    CURSOR_STYLES,
    type TerminalAppearance,
} from '../shared/terminal-appearance';
import { TERMINAL_ZOOM } from '../shared/terminal-zoom';

/** The longest shortcut text a setting may hold. */
const MAX_BINDING_LENGTH = 64;

const THEME_PREFERENCES = ['midnight', 'system', 'light', 'dark', 'hc-light', 'hc-dark'] as const;

/** The theme preferences the app knows. */
export const THEME_SCHEMA = z.enum(THEME_PREFERENCES);

/** One field each of the terminal appearance, exact: a value out of range fails. */
export const APPEARANCE_FIELDS = {
    lineHeight: z.number().min(APPEARANCE.lineHeight.min).max(APPEARANCE.lineHeight.max),
    letterSpacing: z.number().min(APPEARANCE.letterSpacing.min).max(APPEARANCE.letterSpacing.max),
    cursorStyle: z.enum(CURSOR_STYLES),
    cursorWidth: z.number().int().min(APPEARANCE.cursorWidth.min).max(APPEARANCE.cursorWidth.max),
    cursorBlink: z.boolean(),
} as const;

/** The whole terminal appearance, exact. */
export const APPEARANCE_SCHEMA: z.ZodType<TerminalAppearance> = z.object(APPEARANCE_FIELDS).strict();

/** One field each of the settings page's settings, exact: a value out of range fails (A11Y-10.3). */
export const SETTINGS_FIELDS = {
    theme: THEME_SCHEMA,
    verbosity: z.enum(VERBOSITY_LEVELS),
    hints: z.boolean(),
    floodThreshold: z.number().int().min(LIMITS.floodThreshold.min).max(LIMITS.floodThreshold.max),
    minimumContrast: z.union(MINIMUM_CONTRASTS.map((ratio) => z.literal(ratio))),
    terminalZoom: z.number().int().min(TERMINAL_ZOOM.min).max(TERMINAL_ZOOM.max).multipleOf(TERMINAL_ZOOM.step),
    terminalAppearance: APPEARANCE_SCHEMA,
    tabFocusMode: z.boolean(),
    scrollbackLines: z.number().int().min(LIMITS.scrollbackLines.min).max(LIMITS.scrollbackLines.max),
    stopGraceSeconds: z.number().int().min(LIMITS.stopGraceSeconds.min).max(LIMITS.stopGraceSeconds.max),
    autoClose: z.boolean(),
    pasteConfirmation: z.boolean(),
    newSessionFolder: z.enum(NEW_SESSION_FOLDERS),
    shortcuts: z.partialRecord(z.enum(COMMAND_IDS), z.string().min(1).max(MAX_BINDING_LENGTH)),
    plainF6: z.boolean(),
    audioCues: z.boolean(),
    audioVolume: z.number().int().min(LIMITS.audioVolume.min).max(LIMITS.audioVolume.max),
} as const;

const CHANGE = z.object(SETTINGS_FIELDS).partial().strict();

/** A change the settings page asks for: any of its settings, each exact and present, and nothing else. */
export const SETTINGS_CHANGE_SCHEMA = z.custom<Partial<Settings>>(
    (value) => CHANGE.safeParse(value).success && Object.values(value as object).every((field) => field !== undefined),
);

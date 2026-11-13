import { join } from 'node:path';
import { z } from 'zod';
import { SCREEN_READER_MODES, type ScreenReaderMode } from '../shared/accessibility';
import type { ThemePreference } from '../shared/display';
import { SIDEBAR_WIDTH } from '../shared/layout';
import { DEFAULT_SETTINGS, type Settings } from '../shared/settings';
import { DEFAULT_TERMINAL_APPEARANCE, type TerminalAppearance } from '../shared/terminal-appearance';
import { JsonStore } from './json-store';
import { APPEARANCE_FIELDS, SETTINGS_FIELDS, THEME_SCHEMA } from './settings-schema';

/** What the user configured, kept in the TRC home's `config.json` (P-18): the settings page's settings and the layout. */
export interface AppConfig extends Settings {
    /** The sidebar's width in CSS pixels. */
    readonly sidebarWidth: number;
    /** Whether the user hid the sidebar (US-1.6.3). */
    readonly sidebarCollapsed: boolean;
    /** Whether screen-reader mode follows Chromium's detection or is forced on or off (A11Y-10.2). */
    readonly screenReaderMode: ScreenReaderMode;
}

/** The configuration of a new install. */
export const DEFAULT_APP_CONFIG: AppConfig = {
    ...DEFAULT_SETTINGS,
    sidebarWidth: SIDEBAR_WIDTH.initial,
    sidebarCollapsed: false,
    screenReaderMode: 'auto',
};

const APPEARANCE_SCHEMA: z.ZodType<TerminalAppearance> = z.object(
    fallingBack(APPEARANCE_FIELDS, DEFAULT_TERMINAL_APPEARANCE),
);

const CONFIG_SCHEMA: z.ZodType<AppConfig> = z.object({
    ...fallingBack(SETTINGS_FIELDS, DEFAULT_SETTINGS),
    terminalAppearance: APPEARANCE_SCHEMA.catch(DEFAULT_SETTINGS.terminalAppearance),
    sidebarWidth: z.number().int().min(SIDEBAR_WIDTH.min).max(SIDEBAR_WIDTH.max).catch(DEFAULT_APP_CONFIG.sidebarWidth),
    sidebarCollapsed: z.boolean().catch(DEFAULT_APP_CONFIG.sidebarCollapsed),
    screenReaderMode: z.enum(SCREEN_READER_MODES).catch(DEFAULT_APP_CONFIG.screenReaderMode),
});

/** The settings page's settings in a configuration, without the layout. */
export function settingsOf(config: AppConfig): Settings {
    const settings = Object.keys(DEFAULT_SETTINGS).map((key) => [key, config[key as keyof Settings]]);
    return Object.fromEntries(settings) as unknown as Settings;
}

/** The theme preference in `value`, when it names one. */
export function parseThemePreference(value: unknown): ThemePreference | undefined {
    const parsed = THEME_SCHEMA.safeParse(value);
    return parsed.success ? parsed.data : undefined;
}

/**
 * `config.json` in the TRC home. A field it cannot use falls back to its default and the others are kept; updates
 * apply one after the other.
 */
export class AppConfigFile {
    readonly #store: JsonStore<AppConfig>;
    #last: Promise<unknown> = Promise.resolve();

    /** The configuration in `home`. */
    constructor(home: string) {
        this.#store = new JsonStore(join(home, 'config.json'), CONFIG_SCHEMA, DEFAULT_APP_CONFIG);
    }

    /** The current configuration. */
    read(): Promise<AppConfig> {
        return this.#store.read();
    }

    /** Changes some fields and keeps the rest. */
    update(change: Partial<AppConfig>): Promise<void> {
        const next = this.#last.then(async () => this.#store.write({ ...(await this.#store.read()), ...change }));
        this.#last = next.catch(() => undefined);
        return next;
    }
}

type Fields<T> = { readonly [K in keyof T]: z.ZodType<T[K]> };

function fallingBack<T extends object>(fields: Fields<T>, defaults: T): { [K in keyof T]: z.ZodType<T[K]> } {
    const entries = Object.entries(fields).map(([key, schema]) => [
        key,
        (schema as z.ZodType).catch(defaults[key as keyof T]),
    ]);
    return Object.fromEntries(entries) as { [K in keyof T]: z.ZodType<T[K]> };
}

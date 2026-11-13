import { join } from 'node:path';
import { z } from 'zod';
import { DEFAULT_THEME_PREFERENCE, type ThemePreference } from '../shared/display';
import { SIDEBAR_WIDTH } from '../shared/layout';
import { JsonStore } from './json-store';

/** What the user configured, kept in the TRC home's `config.json` (P-18). ST-18's settings page adds the rest. */
export interface AppConfig {
    readonly theme: ThemePreference;
    /** The sidebar's width in CSS pixels. */
    readonly sidebarWidth: number;
    /** Whether the user hid the sidebar (US-1.6.3). */
    readonly sidebarCollapsed: boolean;
}

/** The configuration of a new install. */
export const DEFAULT_APP_CONFIG: AppConfig = {
    theme: DEFAULT_THEME_PREFERENCE,
    sidebarWidth: SIDEBAR_WIDTH.initial,
    sidebarCollapsed: false,
};

const THEME_PREFERENCES = ['midnight', 'system', 'light', 'dark', 'hc-light', 'hc-dark'] as const;
const THEME_SCHEMA = z.enum(THEME_PREFERENCES);

const CONFIG_SCHEMA: z.ZodType<AppConfig> = z.object({
    theme: THEME_SCHEMA.catch(DEFAULT_APP_CONFIG.theme),
    sidebarWidth: z.number().int().min(SIDEBAR_WIDTH.min).max(SIDEBAR_WIDTH.max).catch(DEFAULT_APP_CONFIG.sidebarWidth),
    sidebarCollapsed: z.boolean().catch(DEFAULT_APP_CONFIG.sidebarCollapsed),
});

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

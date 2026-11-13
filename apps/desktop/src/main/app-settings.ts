import { join } from 'node:path';
import { z } from 'zod';
import { DEFAULT_THEME_PREFERENCE, type ThemePreference } from '../shared/display';
import { JsonStore } from './json-store';

/** The settings the main process keeps (P-18). ST-18's settings page adds the rest. */
export interface AppSettings {
    readonly theme: ThemePreference;
}

/** The settings of a new install. */
export const DEFAULT_APP_SETTINGS: AppSettings = { theme: DEFAULT_THEME_PREFERENCE };

const THEME_PREFERENCES = ['midnight', 'system', 'light', 'dark', 'hc-light', 'hc-dark'] as const;

const APP_SETTINGS_SCHEMA: z.ZodType<AppSettings> = z.object({ theme: z.enum(THEME_PREFERENCES) }).strict();

/** The settings file in `userData`. */
export function appSettingsStore(userData: string): JsonStore<AppSettings> {
    return new JsonStore(join(userData, 'settings.json'), APP_SETTINGS_SCHEMA, DEFAULT_APP_SETTINGS);
}

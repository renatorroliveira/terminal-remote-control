import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppConfigFile, parseThemePreference } from './app-config';

/** Where app state used to be kept, and the TRC home it moves to. */
export interface StateFolders {
    readonly userData: string;
    readonly home: string;
}

/**
 * Moves the state earlier versions kept in Application Support into the TRC home, once: the theme from
 * `settings.json` into `config.json`, and `hosts.json` as is. It never replaces a file the TRC home has, and leaves
 * the old files in place.
 */
export async function migrateLegacyState(folders: StateFolders): Promise<void> {
    await migrateSettings(folders);
    await migrateHosts(folders);
}

async function migrateSettings({ userData, home }: StateFolders): Promise<void> {
    const legacy = await readLegacy(join(userData, 'settings.json'), join(home, 'config.json'));
    if (legacy === undefined) {
        return;
    }
    const theme = parseThemePreference(parseJson(legacy)?.theme);
    await new AppConfigFile(home).update(theme === undefined ? {} : { theme });
}

async function migrateHosts({ userData, home }: StateFolders): Promise<void> {
    const target = join(home, 'hosts.json');
    const legacy = await readLegacy(join(userData, 'hosts.json'), target);
    if (legacy === undefined) {
        return;
    }
    await mkdir(home, { recursive: true, mode: 0o700 });
    await writeFile(target, legacy, { mode: 0o600, flag: 'wx' }).catch(() => undefined);
}

async function readLegacy(source: string, target: string): Promise<string | undefined> {
    const targetExists = await access(target).then(
        () => true,
        () => false,
    );
    return targetExists ? undefined : readFile(source, 'utf8').catch(() => undefined);
}

function parseJson(text: string): { readonly theme?: unknown } | undefined {
    try {
        const value: unknown = JSON.parse(text);
        return typeof value === 'object' && value !== null ? (value as { readonly theme?: unknown }) : undefined;
    } catch {
        return undefined;
    }
}

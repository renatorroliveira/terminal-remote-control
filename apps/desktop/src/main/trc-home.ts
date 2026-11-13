import { isAbsolute, join, resolve } from 'node:path';

/**
 * The TRC home, where the app keeps `config.json` and `hosts.json`: `TRC_HOME` when set, where a leading `~` is the
 * user's home folder and a relative path lies under it, otherwise `~/.trc`.
 */
export function trcHome(env: Readonly<Record<string, string | undefined>>, home: string): string {
    const value = env['TRC_HOME'];
    if (value === undefined || value === '') {
        return join(home, '.trc');
    }
    if (value === '~' || value.startsWith('~/')) {
        return join(home, value.slice(1));
    }
    return isAbsolute(value) ? value : resolve(home, value);
}

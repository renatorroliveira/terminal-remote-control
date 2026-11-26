import { posix, win32 } from 'node:path';

/**
 * The TRC home, where the app keeps `config.json` and `hosts.json`: `TRC_HOME` when set, where a leading `~` is the
 * user's home folder (`~/`, and `~\` on Windows, P-95) and a relative path lies under it, otherwise `~/.trc`.
 */
export function trcHome(
    env: Readonly<Record<string, string | undefined>>,
    home: string,
    platform: NodeJS.Platform = process.platform,
): string {
    const paths = platform === 'win32' ? win32 : posix;
    const value = env['TRC_HOME'];
    if (value === undefined || value === '') {
        return paths.join(home, '.trc');
    }
    if (value === '~' || value.startsWith('~/') || (platform === 'win32' && value.startsWith('~\\'))) {
        return paths.join(home, value.slice(1));
    }
    return paths.isAbsolute(value) ? value : paths.resolve(home, value);
}

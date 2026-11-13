import { appendFile } from 'node:fs/promises';
import type { OpenExternal } from './link-service';

/** What decides where opened links go. */
export interface OpenExternalSources {
    readonly seamEnabled: boolean;
    readonly env: Readonly<Record<string, string | undefined>>;
    /** The OS's own opener, `shell.openExternal`. */
    readonly shellOpen: OpenExternal;
}

/**
 * Opens links with the OS. Test builds with `TRC_TEST_OPENED_LINKS` append each link to that file instead, so an
 * e2e run never opens a browser (P-14).
 */
export function openExternalFor({ seamEnabled, env, shellOpen }: OpenExternalSources): OpenExternal {
    const log = seamEnabled ? env['TRC_TEST_OPENED_LINKS'] : undefined;
    if (log === undefined) {
        return shellOpen;
    }
    return (url) => appendFile(log, `${url}\n`, { mode: 0o600 });
}

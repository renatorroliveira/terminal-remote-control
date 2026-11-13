import { appendFile } from 'node:fs/promises';
import type { OpenExternal } from './link-service';

/** What decides where opened links go. */
export interface OpenExternalSources {
    /** The test seam's link log (P-14); release builds have none. */
    readonly openedLinks: string | undefined;
    /** The OS's own opener, `shell.openExternal`. */
    readonly shellOpen: OpenExternal;
}

/**
 * Opens links with the OS. A test build with a link log appends each link to it instead, so an e2e run never opens
 * a browser (P-14).
 */
export function openExternalFor({ openedLinks, shellOpen }: OpenExternalSources): OpenExternal {
    if (openedLinks === undefined) {
        return shellOpen;
    }
    return (url) => appendFile(openedLinks, `${url}\n`, { mode: 0o600 });
}

import type { KnownHost } from '../shared/hosts';

/** What a clipboard write needs: the hosts with their permissions, as `hosts.json` keeps them, and the clipboard. */
export interface ClipboardWriteDeps {
    readonly hosts: () => Promise<readonly KnownHost[]>;
    readonly writeText: (text: string) => void;
}

/**
 * Puts text a host's program wrote with OSC 52 on the clipboard, only when the user allowed that host's writes. The
 * main process checks the permission where it is stored, so the renderer's own check is not the only one (SEC-06.1).
 * True when it wrote the clipboard.
 */
export async function writeHostClipboard(deps: ClipboardWriteDeps, hostId: string, text: string): Promise<boolean> {
    const host = (await deps.hosts()).find((entry) => entry.id === hostId);
    if (host?.allowClipboardWrites !== true) {
        return false;
    }
    deps.writeText(text);
    return true;
}

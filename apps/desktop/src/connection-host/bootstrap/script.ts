/** What the app prepends to the bootstrap script. */
export interface BootstrapParameters {
    /** Marks the script's lines, so startup-file noise is never mistaken for them. Hexadecimal. */
    readonly nonce: string;
    /** The per-host install location: absolute, or starting with `~/` (US-1.4.3). */
    readonly root: string;
}

const NONCE_PATTERN = /^[0-9a-f]+$/;
const FORBIDDEN_IN_ROOT = /[\n\0]/;

/**
 * Builds the text piped to `/bin/sh -s` on the host: the parameters as single-quoted assignments, then the
 * script itself.
 */
export function buildBootstrapScript(template: string, parameters: BootstrapParameters): string {
    if (!NONCE_PATTERN.test(parameters.nonce)) {
        throw new Error('The bootstrap nonce must be hexadecimal.');
    }
    assertInstallRoot(parameters.root);
    return `TRC_NONCE=${quote(parameters.nonce)}\nTRC_ROOT=${quote(parameters.root)}\n${template}`;
}

/** Throws unless `root` is an install location the bootstrap accepts. */
export function assertInstallRoot(root: string): void {
    const anchored = root === '~' || root.startsWith('~/') || root.startsWith('/');
    if (!anchored || FORBIDDEN_IN_ROOT.test(root)) {
        throw new Error(`The install location must be absolute or start with ~/: ${JSON.stringify(root)}`);
    }
}

function quote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
}

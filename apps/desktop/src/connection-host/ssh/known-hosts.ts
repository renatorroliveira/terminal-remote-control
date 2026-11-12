import { createHash, createHmac, randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PresentedHostKey } from './helper-lines';

/** How a known_hosts entry is written. */
export interface KnownHostsFormat {
    /** Hash the host name, as `HashKnownHosts yes` asks. */
    readonly hashed: boolean;
    /** The salt for a hashed host; random when absent. */
    readonly salt?: Uint8Array;
}

const SALT_BYTES = 20;

/** The SHA-256 fingerprint of a base64 public key, in OpenSSH's `SHA256:` form (US-1.2.1). */
export function fingerprintOf(key: string): string {
    const digest = createHash('sha256').update(Buffer.from(key, 'base64')).digest('base64');
    return `SHA256:${digest.replace(/=+$/, '')}`;
}

/** The known_hosts line for an accepted key, with the host hashed as `|1|salt|hmac` when asked. */
export function knownHostsLine(key: PresentedHostKey, format: KnownHostsFormat): string {
    return `${format.hashed ? hashedHost(key.host, format.salt ?? randomBytes(SALT_BYTES)) : key.host} ${key.type} ${key.key}`;
}

/** Appends a line to a known_hosts file, creating it with mode 0600 and its directory with mode 0700. */
export async function appendKnownHost(file: string, line: string): Promise<void> {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const existing = await readFile(file, 'utf8').catch(() => '');
    const separator = existing === '' || existing.endsWith('\n') ? '' : '\n';
    await appendFile(file, `${separator}${line}\n`, { mode: 0o600 });
}

function hashedHost(host: string, salt: Uint8Array): string {
    const hash = createHmac('sha1', salt).update(host).digest('base64');
    return `|1|${Buffer.from(salt).toString('base64')}|${hash}`;
}

/** Where a host is: an SSH config alias or `[user@]host`, and a port the user typed. */
export interface HostAddress {
    readonly destination: string;
    readonly port?: number;
}

/** What ssh accepts as a destination: no spaces or control characters, and no leading dash (an option). */
export const DESTINATION_PATTERN = /^[^\s\p{Cc}-][^\s\p{Cc}]*$/u;

const MAX_PORT = 65_535;
const BRACKETED = /^\[([^\]]+)\]:(\d+)$/;
const WITH_PORT = /^([^:]+):(\d+)$/;

/**
 * Reads what the user typed for a host (US-1.1.1): `alias`, `user@host`, `host:port`, `user@host:port` or
 * `[ipv6]:port`. A bare IPv6 address stays whole. Returns `undefined` when ssh could not use it.
 */
export function parseHostAddress(text: string): HostAddress | undefined {
    const trimmed = text.trim();
    const match = BRACKETED.exec(trimmed) ?? WITH_PORT.exec(trimmed);
    if (match === null) {
        return DESTINATION_PATTERN.test(trimmed) ? { destination: trimmed } : undefined;
    }
    const [, destination = '', portText = ''] = match;
    const port = Number(portText);
    if (!DESTINATION_PATTERN.test(destination) || port < 1 || port > MAX_PORT) {
        return undefined;
    }
    return { destination, port };
}

/** An address as the user would type it. */
export function formatHostAddress({ destination, port }: HostAddress): string {
    if (port === undefined) {
        return destination;
    }
    return destination.includes(':') ? `[${destination}]:${port}` : `${destination}:${port}`;
}

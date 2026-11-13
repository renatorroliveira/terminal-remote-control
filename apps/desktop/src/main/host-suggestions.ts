import { formatHostAddress } from '../shared/host-address';
import type { KnownHost } from '../shared/hosts';

/**
 * The addresses Add host offers (US-1.1.1): the user's recent ones first, then the `Host` names of their SSH
 * configuration, without repeats and without the hosts already added.
 */
export function suggestedAddresses(
    recent: readonly string[],
    configHosts: readonly string[],
    known: readonly KnownHost[],
): readonly string[] {
    const added = new Set(known.map((host) => formatHostAddress(host.address)));
    return [...new Set([...recent, ...configHosts])].filter((address) => !added.has(address));
}

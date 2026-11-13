import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { DESTINATION_PATTERN, formatHostAddress, parseHostAddress } from '../shared/host-address';
import type { KnownHost } from '../shared/hosts';
import { JsonStore } from './json-store';

interface HostsFile {
    readonly hosts: readonly KnownHost[];
}

const HOST_SCHEMA: z.ZodType<KnownHost> = z
    .object({
        id: z.string().regex(/^host-[0-9a-f]{16}$/),
        address: z
            .object({
                destination: z.string().regex(DESTINATION_PATTERN).max(1024),
                port: z.number().int().min(1).max(65_535).exactOptional(),
            })
            .strict(),
        installRoot: z.string().min(1).max(4096),
    })
    .strict();

const FILE_SCHEMA: z.ZodType<HostsFile> = z.object({ hosts: z.array(HOST_SCHEMA).max(1000) }).strict();

/** The hosts the user added, in the order added, kept in `userData/hosts.json` (US-1.1.1, P-18). */
export class KnownHosts {
    readonly #store: JsonStore<HostsFile>;
    #last: Promise<unknown> = Promise.resolve();

    /** The hosts kept under `userData`. */
    constructor(userData: string) {
        this.#store = new JsonStore(join(userData, 'hosts.json'), FILE_SCHEMA, { hosts: [] });
    }

    /** Every known host. */
    async list(): Promise<readonly KnownHost[]> {
        return (await this.#store.read()).hosts;
    }

    /** Adds the host at `addressText`, or returns the known one with the same address and install location. */
    add(addressText: string, installRoot: string): Promise<KnownHost> {
        const added = this.#last.then(() => this.#add(addressText, installRoot));
        this.#last = added.catch(() => undefined);
        return added;
    }

    async #add(addressText: string, installRoot: string): Promise<KnownHost> {
        const address = parseHostAddress(addressText);
        if (address === undefined) {
            throw new Error(`not a host address: ${JSON.stringify(addressText)}`);
        }
        const { hosts } = await this.#store.read();
        const key = formatHostAddress(address);
        const known = hosts.find((host) => formatHostAddress(host.address) === key && host.installRoot === installRoot);
        if (known !== undefined) {
            return known;
        }
        const host: KnownHost = { id: `host-${randomBytes(8).toString('hex')}`, address, installRoot };
        await this.#store.write({ hosts: [...hosts, host] });
        return host;
    }
}

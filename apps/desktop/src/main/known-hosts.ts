import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { DESTINATION_PATTERN, formatHostAddress, parseHostAddress } from '../shared/host-address';
import { isInstallRoot, type KnownHost } from '../shared/hosts';
import { JsonStore } from './json-store';

interface HostsFile {
    readonly hosts: readonly KnownHost[];
    /** Addresses the user added, newest first, offered again even after the host is forgotten (US-1.1.1). */
    readonly recent?: readonly string[];
}

/** How many recent addresses `hosts.json` keeps. */
const RECENT_LIMIT = 20;

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
        allowClipboardWrites: z.boolean().exactOptional(),
    })
    .strict();

const FILE_SCHEMA: z.ZodType<HostsFile> = z
    .object({
        hosts: z.array(HOST_SCHEMA).max(1000),
        recent: z.array(z.string().max(1024)).max(RECENT_LIMIT).exactOptional(),
    })
    .strict();

/** The hosts the user added, in the order added, kept in the TRC home's `hosts.json` (US-1.1.1, P-18). */
export class KnownHosts {
    readonly #store: JsonStore<HostsFile>;
    #last: Promise<unknown> = Promise.resolve();

    /** The hosts kept in `home`. */
    constructor(home: string) {
        this.#store = new JsonStore(join(home, 'hosts.json'), FILE_SCHEMA, { hosts: [] });
    }

    /** Every known host. */
    async list(): Promise<readonly KnownHost[]> {
        return (await this.#store.read()).hosts;
    }

    /** Addresses the user added, newest first, including forgotten hosts (US-1.1.1). */
    async recent(): Promise<readonly string[]> {
        return (await this.#store.read()).recent ?? [];
    }

    /** Adds the host at `addressText`, or returns the known one with the same address and install location. */
    add(addressText: string, installRoot: string): Promise<KnownHost> {
        return this.#serially(() => this.#add(addressText, installRoot));
    }

    /** Forgets a host; its address stays among the recent ones (A11Y-11.9). */
    remove(id: string): Promise<void> {
        return this.#serially(async () => {
            const file = await this.#store.read();
            await this.#store.write({ ...file, hosts: file.hosts.filter((host) => host.id !== id) });
        });
    }

    /** Moves a host's install location, for a home directory that cannot run programs (US-1.4.3). */
    setInstallRoot(id: string, installRoot: string): Promise<KnownHost> {
        return this.#serially(async () => {
            if (!isInstallRoot(installRoot)) {
                throw new Error(`not an install location: ${JSON.stringify(installRoot)}`);
            }
            const file = await this.#store.read();
            const host = file.hosts.find((entry) => entry.id === id);
            if (host === undefined) {
                throw new Error(`no host ${id}`);
            }
            const moved: KnownHost = { ...host, installRoot };
            await this.#store.write({ ...file, hosts: file.hosts.map((entry) => (entry.id === id ? moved : entry)) });
            return moved;
        });
    }

    #serially<T>(change: () => Promise<T>): Promise<T> {
        const next = this.#last.then(change);
        this.#last = next.catch(() => undefined);
        return next;
    }

    async #add(addressText: string, installRoot: string): Promise<KnownHost> {
        const address = parseHostAddress(addressText);
        if (address === undefined) {
            throw new Error(`not a host address: ${JSON.stringify(addressText)}`);
        }
        const file = await this.#store.read();
        const key = formatHostAddress(address);
        const recent = [key, ...(file.recent ?? []).filter((entry) => entry !== key)].slice(0, RECENT_LIMIT);
        const known = file.hosts.find(
            (host) => formatHostAddress(host.address) === key && host.installRoot === installRoot,
        );
        const host: KnownHost = known ?? { id: `host-${randomBytes(8).toString('hex')}`, address, installRoot };
        await this.#store.write({ hosts: known === undefined ? [...file.hosts, host] : file.hosts, recent });
        return host;
    }
}

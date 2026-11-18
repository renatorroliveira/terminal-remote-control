import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { DESTINATION_PATTERN, formatHostAddress, parseHostAddress } from '../shared/host-address';
import { HOST_ID_PATTERN, isInstallRoot, type KnownHost, LOCAL_HOST_ID } from '../shared/hosts';
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
        id: z.string().regex(HOST_ID_PATTERN),
        address: z
            .object({
                destination: z.string().regex(DESTINATION_PATTERN).max(1024),
                port: z.number().int().min(1).max(65_535).exactOptional(),
            })
            .strict(),
        installRoot: z.string().min(1).max(4096),
        allowClipboardWrites: z.boolean().exactOptional(),
        shellIntegrationOff: z.boolean().exactOptional(),
        daemonRemoved: z.boolean().exactOptional(),
        local: z.literal(true).exactOptional(),
    })
    .strict();

const FILE_SCHEMA: z.ZodType<HostsFile> = z
    .object({
        hosts: z.array(HOST_SCHEMA).max(1000),
        recent: z.array(z.string().max(1024)).max(RECENT_LIMIT).exactOptional(),
    })
    .strict();

/** Where This computer's daemon installs, when the app has one (US-4.1, P-56). */
export interface KnownHostsOptions {
    readonly localRoot?: string;
}

/**
 * The hosts the user added, in the order added, kept in the TRC home's `hosts.json` (US-1.1.1, P-18), after This
 * computer when the app has a local daemon: its settings are kept there too, but it is never forgotten or moved, and
 * it always installs in `localRoot` (US-4.2.1, P-56).
 */
export class KnownHosts {
    readonly #store: JsonStore<HostsFile>;
    readonly #localRoot: string | undefined;
    #last: Promise<unknown> = Promise.resolve();

    /** The hosts kept in `home`. */
    constructor(home: string, options: KnownHostsOptions = {}) {
        this.#store = new JsonStore(join(home, 'hosts.json'), FILE_SCHEMA, { hosts: [] });
        this.#localRoot = options.localRoot;
    }

    /** Every known host: This computer first, when the app has it, then the others in the order added. */
    async list(): Promise<readonly KnownHost[]> {
        return this.#withLocal((await this.#store.read()).hosts);
    }

    /** Addresses the user added, newest first, including forgotten hosts (US-1.1.1). */
    async recent(): Promise<readonly string[]> {
        return (await this.#store.read()).recent ?? [];
    }

    /** Adds the host at `addressText`, or returns the known one with the same address and install location. */
    add(addressText: string, installRoot: string): Promise<KnownHost> {
        return this.#serially(() => this.#add(addressText, installRoot));
    }

    /** Forgets a host; its address stays among the recent ones (A11Y-11.9). This computer cannot be forgotten. */
    remove(id: string): Promise<void> {
        if (id === LOCAL_HOST_ID) {
            return Promise.reject(new Error('This computer cannot be forgotten'));
        }
        return this.#serially(async () => {
            const file = await this.#store.read();
            await this.#store.write({ ...file, hosts: file.hosts.filter((host) => host.id !== id) });
        });
    }

    /** Moves a host's install location, for a home directory that cannot run programs (US-1.4.3). */
    setInstallRoot(id: string, installRoot: string): Promise<KnownHost> {
        if (id === LOCAL_HOST_ID) {
            return Promise.reject(new Error('This computer always installs in the TRC home'));
        }
        if (!isInstallRoot(installRoot)) {
            return Promise.reject(new Error(`not an install location: ${JSON.stringify(installRoot)}`));
        }
        return this.#change(id, (host) => ({ ...host, installRoot }));
    }

    /** Lets a host's programs write the clipboard with OSC 52, or stops them (SEC-06.1); off drops the field. */
    setClipboardWrites(id: string, allowed: boolean): Promise<KnownHost> {
        return this.#change(id, ({ allowClipboardWrites: _previous, ...host }) =>
            allowed ? { ...host, allowClipboardWrites: true } : host,
        );
    }

    /** Starts a host's new shells with shell integration, or without it (US-5.1.3); on drops the field. */
    setShellIntegration(id: string, on: boolean): Promise<KnownHost> {
        return this.#change(id, ({ shellIntegrationOff: _previous, ...host }) =>
            on ? host : { ...host, shellIntegrationOff: true },
        );
    }

    /** Marks a host whose daemon the user removed, so it is not connected at launch (P-45); false drops the mark. */
    setDaemonRemoved(id: string, removed: boolean): Promise<KnownHost> {
        return this.#change(id, ({ daemonRemoved: _previous, ...host }) =>
            removed ? { ...host, daemonRemoved: true } : host,
        );
    }

    #change(id: string, change: (host: KnownHost) => KnownHost): Promise<KnownHost> {
        return this.#serially(async () => {
            const file = await this.#store.read();
            const hosts = this.#withLocal(file.hosts);
            const host = hosts.find((entry) => entry.id === id);
            if (host === undefined) {
                throw new Error(`no host ${id}`);
            }
            const changed = change(host);
            const kept = hosts.map((entry) => (entry.id === id ? changed : entry)).filter(isSaved);
            await this.#store.write({ ...file, hosts: kept });
            return changed;
        });
    }

    /** The hosts with This computer first, installing in the local root, when the app has one. */
    #withLocal(hosts: readonly KnownHost[]): readonly KnownHost[] {
        const others = hosts.filter((host) => host.id !== LOCAL_HOST_ID);
        if (this.#localRoot === undefined) {
            return others;
        }
        const saved = hosts.find((host) => host.id === LOCAL_HOST_ID);
        const local: KnownHost = {
            ...saved,
            id: LOCAL_HOST_ID,
            address: { destination: 'localhost' },
            installRoot: this.#localRoot,
            local: true,
        };
        return [local, ...others];
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

/** Whether `hosts.json` keeps a host: every host the user added, and This computer only for a setting of its own. */
function isSaved(host: KnownHost): boolean {
    return (
        host.id !== LOCAL_HOST_ID ||
        host.allowClipboardWrites === true ||
        host.daemonRemoved === true ||
        host.shellIntegrationOff === true
    );
}

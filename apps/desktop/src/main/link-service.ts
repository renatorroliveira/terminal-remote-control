import { join } from 'node:path';
import { z } from 'zod';
import { type LinkCheck, linkOrigin, MAX_LINK_LENGTH, matchesPrefix, normalizeLink } from '../shared/links';
import { JsonStore } from './json-store';

/** Opens a URL in the app the OS assigns to its scheme, as `shell.openExternal` does. */
export type OpenExternal = (url: string) => Promise<void>;

const PREFIXES: z.ZodType<readonly string[]> = z
    .array(z.unknown())
    .transform((items) =>
        items.filter((item): item is string => typeof item === 'string' && item.length <= MAX_LINK_LENGTH),
    );

/**
 * Opens links from the terminal (US-1.12.3, US-1.12.4). A link opens without asking only when it starts with a
 * prefix in `accept_urls.json` in the TRC home; otherwise the renderer confirms it first, and the confirmation can
 * trust the link's origin. Targets the app must never open are refused (SEC-06).
 */
export class LinkService {
    readonly #store: JsonStore<readonly string[]>;
    readonly #openExternal: OpenExternal;
    #last: Promise<unknown> = Promise.resolve();

    /** Links trusted in `home`'s `accept_urls.json`, opened with `openExternal`. */
    constructor(home: string, openExternal: OpenExternal) {
        this.#store = new JsonStore(join(home, 'accept_urls.json'), PREFIXES, []);
        this.#openExternal = openExternal;
    }

    /** The link as it would open, its origin and whether it is trusted; undefined for a target never opened. */
    async check(target: string): Promise<LinkCheck | undefined> {
        const link = normalizeLink(target);
        if (link === undefined) {
            return undefined;
        }
        const prefixes = await this.#store.read();
        return {
            target: link,
            origin: linkOrigin(link),
            trusted: prefixes.some((prefix) => matchesPrefix(link, prefix)),
        };
    }

    /** Opens a link the user confirmed or trusts, first trusting its origin when `trustOrigin` is set. */
    async open(target: string, trustOrigin: boolean): Promise<void> {
        const link = normalizeLink(target);
        if (link === undefined) {
            return;
        }
        const origin = linkOrigin(link);
        if (trustOrigin && origin !== undefined) {
            await this.#trust(origin);
        }
        await this.#openExternal(link);
    }

    #trust(prefix: string): Promise<void> {
        const next = this.#last.then(async () => {
            const prefixes = await this.#store.read();
            if (!prefixes.includes(prefix)) {
                await this.#store.write([...prefixes, prefix]);
            }
        });
        this.#last = next.catch(() => undefined);
        return next;
    }
}

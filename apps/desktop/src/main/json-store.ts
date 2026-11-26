import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { z } from 'zod';

/** How a failed replacement is retried: up to 1 s in all (P-95). */
const REPLACE_ATTEMPTS = 10;
const REPLACE_PAUSE_MS = 100;
/** The errors Windows gives a rename while another process, such as an antivirus or the indexer, holds the file. */
const SHARING_ERRORS: ReadonlySet<string> = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** How {@link replaceFile} renames and waits, and on which platform; the real ones unless a test says otherwise. */
export interface ReplaceOptions {
    readonly rename?: (from: string, to: string) => Promise<void>;
    readonly pause?: (ms: number) => Promise<unknown>;
    readonly platform?: NodeJS.Platform;
}

/**
 * Renames `from` over `to`, retrying on Windows for up to 1 s when it reports the file in use, as an antivirus or the
 * indexer can hold the old file for a moment (P-95); any other error, or the last one, is thrown.
 */
export async function replaceFile(
    from: string,
    to: string,
    { rename: rename_ = rename, pause = sleep, platform = process.platform }: ReplaceOptions = {},
): Promise<void> {
    const attempts = platform === 'win32' ? REPLACE_ATTEMPTS : 1;
    for (let attempt = 1; ; attempt += 1) {
        try {
            await rename_(from, to);
            return;
        } catch (error) {
            const code = (error as { code?: unknown }).code;
            if (attempt >= attempts || typeof code !== 'string' || !SHARING_ERRORS.has(code)) {
                throw error;
            }
            await pause(REPLACE_PAUSE_MS);
        }
    }
}

/**
 * One JSON file of app state (P-18): read and validated with zod, falling back to defaults when missing or
 * invalid, and written atomically (temporary file, fsync, rename) with mode 0600 in a 0700 directory.
 */
export class JsonStore<T> {
    readonly #file: string;
    readonly #schema: z.ZodType<T>;
    readonly #defaults: T;

    /** A store for `file`, validated by `schema`. */
    constructor(file: string, schema: z.ZodType<T>, defaults: T) {
        this.#file = file;
        this.#schema = schema;
        this.#defaults = defaults;
    }

    /** The stored value, or the defaults when there is none or it does not validate. */
    async read(): Promise<T> {
        const text = await readFile(this.#file, 'utf8').catch(() => undefined);
        if (text === undefined) {
            return this.#defaults;
        }
        try {
            const parsed = this.#schema.safeParse(JSON.parse(text));
            return parsed.success ? parsed.data : this.#defaults;
        } catch {
            return this.#defaults;
        }
    }

    /** Validates and replaces the stored value atomically. */
    async write(value: T): Promise<void> {
        const valid = this.#schema.parse(value);
        const dir = dirname(this.#file);
        await mkdir(dir, { recursive: true, mode: 0o700 });
        const temporary = `${this.#file}.${randomBytes(6).toString('hex')}.tmp`;
        const handle = await open(temporary, 'wx', 0o600);
        try {
            await handle.writeFile(`${JSON.stringify(valid, null, 4)}\n`);
            await handle.sync();
        } finally {
            await handle.close();
        }
        await replaceFile(temporary, this.#file).catch(async (error: unknown) => {
            await rm(temporary, { force: true });
            throw error;
        });
        // Windows refuses to flush a directory handle (EPERM); NTFS's metadata journal keeps the rename consistent.
        if (process.platform !== 'win32') {
            const directory = await open(dir, 'r');
            await directory.sync().finally(() => directory.close());
        }
    }
}

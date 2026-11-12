import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { z } from 'zod';

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
        await rename(temporary, this.#file);
        const directory = await open(dir, 'r');
        await directory.sync().finally(() => directory.close());
    }
}

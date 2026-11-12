import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** A value that must never reach a log, such as terminal bytes or keystrokes. It serializes as `[redacted]`. */
export class Sensitive<T> {
    readonly #value: T;

    /** Wraps a value. */
    constructor(value: T) {
        this.#value = value;
    }

    /** The wrapped value, for code that needs it. */
    get value(): T {
        return this.#value;
    }

    /** What logs see. */
    toJSON(): string {
        return '[redacted]';
    }

    /** What string conversion sees. */
    toString(): string {
        return '[redacted]';
    }
}

/** Fields of a log line: identifiers, codes and counts only (SEC-08). */
export type LogFields = Readonly<Record<string, string | number | boolean | Sensitive<unknown> | undefined>>;

/** The connection host's log. */
export interface AppLogger {
    info(event: string, fields?: LogFields): void;
    warn(event: string, fields?: LogFields): void;
    error(event: string, fields?: LogFields): void;
}

const LOG_FILE = 'connection-host.log';

/** A logger appending JSON lines to `connection-host.log` in `dir`, created with modes 0700 and 0600. */
export function createAppLogger(dir: string, now: () => Date = () => new Date()): AppLogger {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, LOG_FILE);
    const write = (level: string, event: string, fields: LogFields = {}): void => {
        const line = JSON.stringify({ time: now().toISOString(), level, event, ...fields });
        appendFileSync(file, `${line}\n`, { mode: 0o600 });
    };
    return {
        info: (event, fields) => write('info', event, fields),
        warn: (event, fields) => write('warn', event, fields),
        error: (event, fields) => write('error', event, fields),
    };
}

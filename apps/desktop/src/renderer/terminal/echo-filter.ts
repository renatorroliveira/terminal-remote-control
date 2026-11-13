/** How long a typed character waits for its echo. */
const ECHO_TIMEOUT_MS = 2_000;
/** The most typed characters kept waiting for their echo. */
const MOST_PENDING = 4_096;
const ERASE_KEYS: ReadonlySet<string> = new Set(['\u007f', '\b']);
const C0_END = 0x1f;
const DELETE = 0x7f;
const C1_END = 0x9f;

interface TypedCharacter {
    readonly character: string;
    readonly at: number;
}

/**
 * Remembers what the user typed so the shell's echo of it is not spoken again: the screen reader already echoed
 * the keys by its own typing-echo settings (A11Y-01.4, R9).
 */
export class EchoFilter {
    readonly #now: () => number;
    #typed: TypedCharacter[] = [];

    /** A filter on the clock `now`, in milliseconds. */
    constructor(now: () => number) {
        this.#now = now;
    }

    /** Records input sent to the process: printable text waits for its echo, and Backspace forgets the last character. */
    typed(text: string): void {
        if (ERASE_KEYS.has(text)) {
            this.#typed.pop();
            return;
        }
        if (hasControlCharacter(text)) {
            return;
        }
        const at = this.#now();
        this.#forgetOld();
        for (const character of characters(text)) {
            this.#typed.push({ character, at });
        }
        this.#typed.splice(0, Math.max(0, this.#typed.length - MOST_PENDING));
    }

    /** How many typed characters wait for their echo. */
    get pending(): number {
        return this.#typed.length;
    }

    /** Removes the echo of typed characters from the start of `text`; typing it does not match is forgotten. */
    strip(text: string): string {
        this.#forgetOld();
        const output = characters(text);
        let matched = 0;
        while (matched < output.length && this.#typed[matched]?.character === output[matched]) {
            matched += 1;
        }
        this.#typed = matched === 0 && output.length > 0 ? [] : this.#typed.slice(matched);
        return output.slice(matched).join('');
    }

    #forgetOld(): void {
        const oldest = this.#now() - ECHO_TIMEOUT_MS;
        this.#typed = this.#typed.filter((entry) => entry.at >= oldest);
    }
}

function hasControlCharacter(text: string): boolean {
    for (const character of text) {
        const code = character.codePointAt(0) ?? 0;
        if (code <= C0_END || (code >= DELETE && code <= C1_END)) {
            return true;
        }
    }
    return false;
}

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function characters(text: string): readonly string[] {
    return Array.from(SEGMENTER.segment(text), (segment) => segment.segment);
}

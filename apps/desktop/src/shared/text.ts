/** How to strip control characters. */
export interface StripOptions {
    /** Keeps `\n`, which separates the lines of spoken output. */
    readonly keepLineBreaks?: boolean;
}

const C0_END = 0x1f;
const DELETE = 0x7f;
const C1_END = 0x9f;
const LINE_FEED = 0x0a;

/**
 * Removes C0, DEL and C1 control characters, so text that came from terminal output, such as a title or an
 * announcement, can never carry an escape sequence to the screen or to speech (SEC-06.4).
 */
export function stripControlCharacters(text: string, options: StripOptions = {}): string {
    let result = '';
    for (const character of text) {
        const code = character.codePointAt(0) ?? 0;
        const control = code <= C0_END || (code >= DELETE && code <= C1_END);
        if (!control || (options.keepLineBreaks === true && code === LINE_FEED)) {
            result += character;
        }
    }
    return result;
}

const BRACKETED_START = '\u001b[200~';
const BRACKETED_END = '\u001b[201~';
const BRACKETS: readonly string[] = [BRACKETED_START, BRACKETED_END];
const LINE_BREAK = /\r\n|\r|\n/;

/**
 * Pasted text as the process receives it (US-1.12.2): line breaks as Return, and wrapped in bracketed paste when
 * the program asked for it, without any bracket sequence of its own, so pasted text can never end the paste early.
 */
export function encodePaste(text: string, bracketed: boolean): string {
    const typed = text.replace(/\r\n|\n/g, '\r');
    const inner = BRACKETS.reduce((text, bracket) => text.replaceAll(bracket, ''), typed);
    return bracketed ? `${BRACKETED_START}${inner}${BRACKETED_END}` : typed;
}

/** How many lines pasted text holds; a final line break ends the last line rather than starting another. */
export function pastedLines(text: string): number {
    const lines = text.split(LINE_BREAK);
    return lines.length > 1 && lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

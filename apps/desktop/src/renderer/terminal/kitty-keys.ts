import type { EncoderModes, KeyInput } from './key-encoder';

/** The kitty keyboard protocol's "disambiguate escape codes" flag (D-30). */
export const KITTY_DISAMBIGUATE = 0b1;

const ESC = '\u001b';
/** Keys that keep their legacy bytes unless modified, so `reset` still works after a program crashes. */
const LEGACY_WHEN_PLAIN: Readonly<Record<string, number>> = { Enter: 13, Tab: 9, Backspace: 127 };
const BASE_BY_CODE: Readonly<Record<string, string>> = {
    Space: ' ',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backquote: '`',
};

/**
 * Encodes a key at the protocol's disambiguate level: Escape, and modified Enter, Tab and Backspace, as `CSI code;
 * modifiers u`, and Ctrl or Alt with a text key as `CSI unshifted-key; modifiers u`. Returns `undefined` when the
 * legacy encoding stands: plain text, functional keys and anything else the level leaves alone.
 */
export function disambiguatedKey(input: KeyInput, modes: EncoderModes): string | undefined {
    const modifiers = modifierBits(input.shiftKey, input.altKey, input.ctrlKey);
    if (input.key === 'Escape') {
        return csiU(27, modifiers);
    }
    const plainCode = LEGACY_WHEN_PLAIN[input.key];
    if (plainCode !== undefined) {
        return modifiers === 0 ? undefined : csiU(plainCode, modifiers);
    }
    if (input.key === 'F3' && modifiers > 0) {
        return `${ESC}[13;${modifiers + 1}~`;
    }
    return textKey(input, modes);
}

function textKey(input: KeyInput, modes: EncoderModes): string | undefined {
    const base = baseKey(input.code);
    const alt = input.altKey && (!modes.isMac || modes.macOptionIsMeta);
    if (base === undefined || (!input.ctrlKey && !alt)) {
        return undefined;
    }
    return csiU(base.codePointAt(0) ?? 0, modifierBits(input.shiftKey, alt, input.ctrlKey));
}

function baseKey(code: string): string | undefined {
    if (/^Key[A-Z]$/.test(code)) {
        return code.slice(3).toLowerCase();
    }
    if (/^Digit[0-9]$/.test(code)) {
        return code.slice(5);
    }
    return BASE_BY_CODE[code];
}

function modifierBits(shift: boolean, alt: boolean, ctrl: boolean): number {
    return (shift ? 1 : 0) | (alt ? 2 : 0) | (ctrl ? 4 : 0);
}

function csiU(code: number, modifiers: number): string {
    return modifiers === 0 ? `${ESC}[${code}u` : `${ESC}[${code};${modifiers + 1}u`;
}

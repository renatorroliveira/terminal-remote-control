/**
 * Terminal key encoding, ported from xterm.js `src/common/input/Keyboard.ts` (MIT License; Copyright (c) 2014 The
 * xterm.js authors, Copyright (c) 2012-2013 Christopher Jeffrey). It covers the keys that never produce text input;
 * printable characters, IME and dictation arrive through `beforeinput` instead (D-22). It reads `event.key` and
 * `event.code` rather than the deprecated `keyCode`, with the same output.
 */

/** The parts of a keyboard event the encoder reads. */
export interface KeyInput {
    readonly key: string;
    readonly code: string;
    readonly altKey: boolean;
    readonly ctrlKey: boolean;
    readonly shiftKey: boolean;
    readonly metaKey: boolean;
}

/** Terminal modes and preferences that change the encoding. */
export interface EncoderModes {
    /** DECCKM: cursor keys send `ESC O` instead of `ESC [`. */
    readonly applicationCursorKeys: boolean;
    /** Option acts as Meta on macOS; off by default, so Option types characters. */
    readonly macOptionIsMeta: boolean;
    readonly isMac: boolean;
}

/** What a key does in the terminal. */
export type KeyAction =
    | { readonly kind: 'send'; readonly bytes: string }
    | { readonly kind: 'page'; readonly direction: 'up' | 'down' }
    | { readonly kind: 'none' };

const ESC = '\u001b';
const NONE: KeyAction = { kind: 'none' };
const CURSOR_FINALS: Readonly<Record<string, string>> = {
    ArrowUp: 'A',
    ArrowDown: 'B',
    ArrowRight: 'C',
    ArrowLeft: 'D',
    Home: 'H',
    End: 'F',
};
const SS3_FUNCTION_FINALS: Readonly<Record<string, string>> = { F1: 'P', F2: 'Q', F3: 'R', F4: 'S' };
const TILDE_CODES: Readonly<Record<string, number>> = {
    F5: 15,
    F6: 17,
    F7: 18,
    F8: 19,
    F9: 20,
    F10: 21,
    F11: 23,
    F12: 24,
};
const CONTROL_BY_CODE: Readonly<Record<string, string>> = {
    Space: '\u0000',
    Digit3: ESC,
    Digit4: '\u001c',
    Digit5: '\u001d',
    Digit6: '\u001e',
    Digit7: '\u001f',
    Digit8: '\u007f',
    BracketLeft: ESC,
    Backslash: '\u001c',
    BracketRight: '\u001d',
};
const SHIFTED_BY_CODE: Readonly<Record<string, readonly [string, string]>> = {
    Digit0: ['0', ')'],
    Digit1: ['1', '!'],
    Digit2: ['2', '@'],
    Digit3: ['3', '#'],
    Digit4: ['4', '$'],
    Digit5: ['5', '%'],
    Digit6: ['6', '^'],
    Digit7: ['7', '&'],
    Digit8: ['8', '*'],
    Digit9: ['9', '('],
    Semicolon: [';', ':'],
    Equal: ['=', '+'],
    Comma: [',', '<'],
    Minus: ['-', '_'],
    Period: ['.', '>'],
    Slash: ['/', '?'],
    Backquote: ['`', '~'],
    BracketLeft: ['[', '{'],
    Backslash: ['\\', '|'],
    BracketRight: [']', '}'],
    Quote: ["'", '"'],
};

/** Encodes a key press for the terminal, or `none` when the key is text input or belongs to the app. */
export function encodeKey(input: KeyInput, modes: EncoderModes): KeyAction {
    if (input.metaKey) {
        return NONE;
    }
    const special = specialKey(input, modifierCode(input), modes);
    if (special !== undefined) {
        return special;
    }
    return send(combinationBytes(input, modes));
}

function specialKey(input: KeyInput, modifiers: number, modes: EncoderModes): KeyAction | undefined {
    const cursor = CURSOR_FINALS[input.key];
    if (cursor !== undefined) {
        return send(
            modifiers > 0
                ? `${ESC}[1;${modifiers + 1}${cursor}`
                : `${ESC}${modes.applicationCursorKeys ? 'O' : '['}${cursor}`,
        );
    }
    const ss3 = SS3_FUNCTION_FINALS[input.key];
    if (ss3 !== undefined) {
        return send(modifiers > 0 ? `${ESC}[1;${modifiers + 1}${ss3}` : `${ESC}O${ss3}`);
    }
    const tilde = TILDE_CODES[input.key];
    if (tilde !== undefined) {
        return send(withModifiers(tilde, modifiers));
    }
    return editingKey(input, modifiers);
}

function editingKey(input: KeyInput, modifiers: number): KeyAction | undefined {
    const altPrefix = input.altKey ? ESC : '';
    switch (input.key) {
        case 'Enter':
            return send(`${altPrefix}\r`);
        case 'Escape':
            return send(`${altPrefix}${ESC}`);
        case 'Backspace':
            return send(`${altPrefix}${input.ctrlKey ? '\b' : '\u007f'}`);
        case 'Tab':
            return send(input.shiftKey ? `${ESC}[Z` : '\t');
        case 'Insert':
            return input.shiftKey || input.ctrlKey ? NONE : send(`${ESC}[2~`);
        case 'Delete':
            return send(withModifiers(3, modifiers));
        case 'PageUp':
        case 'PageDown':
            return pageKey(input, modifiers);
        default:
            return undefined;
    }
}

function pageKey(input: KeyInput, modifiers: number): KeyAction {
    const up = input.key === 'PageUp';
    if (input.shiftKey) {
        return { kind: 'page', direction: up ? 'up' : 'down' };
    }
    const code = up ? 5 : 6;
    return send(input.ctrlKey ? withModifiers(code, modifiers) : `${ESC}[${code}~`);
}

function combinationBytes(input: KeyInput, modes: EncoderModes): string | undefined {
    if (input.ctrlKey && !input.shiftKey && !input.altKey) {
        return controlCharacter(input);
    }
    if (input.altKey && (!modes.isMac || modes.macOptionIsMeta)) {
        return metaBytes(input);
    }
    if (input.ctrlKey && input.key === '_') {
        return '\u001f';
    }
    return input.ctrlKey && input.key === '@' ? '\u0000' : undefined;
}

function controlCharacter(input: KeyInput): string | undefined {
    const letter = letterOf(input);
    if (letter !== undefined) {
        return String.fromCharCode(letter.toUpperCase().charCodeAt(0) - 64);
    }
    return CONTROL_BY_CODE[input.code];
}

function metaBytes(input: KeyInput): string | undefined {
    const shifted = SHIFTED_BY_CODE[input.code];
    if (shifted !== undefined) {
        return `${ESC}${shifted[input.shiftKey ? 1 : 0]}`;
    }
    const letter = letterOf(input) ?? deadKeyLetter(input);
    if (letter !== undefined) {
        return `${ESC}${metaLetter(letter, input)}`;
    }
    if (input.code !== 'Space') {
        return undefined;
    }
    return `${ESC}${input.ctrlKey ? '\u0000' : ' '}`;
}

function metaLetter(letter: string, input: KeyInput): string {
    if (input.ctrlKey) {
        return String.fromCharCode(letter.toUpperCase().charCodeAt(0) - 64);
    }
    return input.shiftKey ? letter.toUpperCase() : letter.toLowerCase();
}

function deadKeyLetter(input: KeyInput): string | undefined {
    return input.key === 'Dead' && input.code.startsWith('Key') ? input.code.slice(3, 4) : undefined;
}

function letterOf(input: KeyInput): string | undefined {
    if (/^[a-zA-Z]$/.test(input.key)) {
        return input.key;
    }
    return /^Key[A-Z]$/.test(input.code) && input.key !== 'Dead' && input.key.length === 1
        ? input.code.slice(3, 4)
        : undefined;
}

function modifierCode(input: KeyInput): number {
    return (input.shiftKey ? 1 : 0) | (input.altKey ? 2 : 0) | (input.ctrlKey ? 4 : 0);
}

function withModifiers(code: number, modifiers: number): string {
    return modifiers > 0 ? `${ESC}[${code};${modifiers + 1}~` : `${ESC}[${code}~`;
}

function send(bytes: string | undefined): KeyAction {
    return bytes === undefined ? NONE : { kind: 'send', bytes };
}

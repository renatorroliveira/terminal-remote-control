import { describe, expect, it } from 'vitest';
import { encodeKey, type KeyInput } from './key-encoder';

const ESC = '\u001b';

function key(name: string, code = '', modifiers: Partial<KeyInput> = {}): KeyInput {
    return { key: name, code, altKey: false, ctrlKey: false, shiftKey: false, metaKey: false, ...modifiers };
}

const normal = { applicationCursorKeys: false, macOptionIsMeta: false, isMac: true, kittyFlags: 0 };
const app = { ...normal, applicationCursorKeys: true };

function bytes(input: KeyInput, modes = normal): string | undefined {
    const action = encodeKey(input, modes);
    return action.kind === 'send' ? action.bytes : undefined;
}

describe('encodeKey (ported from xterm.js Keyboard.ts)', () => {
    it('encodes editing keys', () => {
        expect(bytes(key('Enter'))).toBe('\r');
        expect(bytes(key('Enter', '', { altKey: true }))).toBe(`${ESC}\r`);
        expect(bytes(key('Backspace'))).toBe('\u007f');
        expect(bytes(key('Backspace', '', { ctrlKey: true }))).toBe('\b');
        expect(bytes(key('Backspace', '', { altKey: true }))).toBe(`${ESC}\u007f`);
        expect(bytes(key('Tab'))).toBe('\t');
        expect(bytes(key('Tab', '', { shiftKey: true }))).toBe(`${ESC}[Z`);
        expect(bytes(key('Escape'))).toBe(ESC);
        expect(bytes(key('Escape', '', { altKey: true }))).toBe(`${ESC}${ESC}`);
        expect(bytes(key('Insert'))).toBe(`${ESC}[2~`);
        expect(bytes(key('Insert', '', { shiftKey: true }))).toBeUndefined();
        expect(bytes(key('Delete'))).toBe(`${ESC}[3~`);
        expect(bytes(key('Delete', '', { ctrlKey: true }))).toBe(`${ESC}[3;5~`);
    });

    it('encodes cursor keys in normal and application mode, with modifiers', () => {
        expect(bytes(key('ArrowUp'))).toBe(`${ESC}[A`);
        expect(bytes(key('ArrowUp'), app)).toBe(`${ESC}OA`);
        expect(bytes(key('ArrowLeft', '', { shiftKey: true }))).toBe(`${ESC}[1;2D`);
        expect(bytes(key('ArrowRight', '', { ctrlKey: true, altKey: true }))).toBe(`${ESC}[1;7C`);
        expect(bytes(key('ArrowDown', '', { metaKey: true }))).toBeUndefined();
        expect(bytes(key('Home'))).toBe(`${ESC}[H`);
        expect(bytes(key('End'), app)).toBe(`${ESC}OF`);
        expect(bytes(key('Home', '', { ctrlKey: true }))).toBe(`${ESC}[1;5H`);
    });
});

describe('encodeKey navigation keys', () => {
    it('encodes page keys, and Shift+Page scrolls the view instead', () => {
        expect(bytes(key('PageUp'))).toBe(`${ESC}[5~`);
        expect(bytes(key('PageDown', '', { ctrlKey: true }))).toBe(`${ESC}[6;5~`);
        expect(encodeKey(key('PageUp', '', { shiftKey: true }), normal)).toEqual({ kind: 'page', direction: 'up' });
        expect(encodeKey(key('PageDown', '', { shiftKey: true }), normal)).toEqual({ kind: 'page', direction: 'down' });
    });

    it('encodes function keys', () => {
        expect(bytes(key('F1'))).toBe(`${ESC}OP`);
        expect(bytes(key('F4', '', { shiftKey: true }))).toBe(`${ESC}[1;2S`);
        expect(bytes(key('F5'))).toBe(`${ESC}[15~`);
        expect(bytes(key('F6', '', { ctrlKey: true }))).toBe(`${ESC}[17;5~`);
        expect(bytes(key('F12'))).toBe(`${ESC}[24~`);
    });

    it('encodes Ctrl with letters, space and the C0 punctuation keys', () => {
        expect(bytes(key('c', 'KeyC', { ctrlKey: true }))).toBe('\u0003');
        expect(bytes(key('z', 'KeyZ', { ctrlKey: true }))).toBe('\u001a');
        expect(bytes(key(' ', 'Space', { ctrlKey: true }))).toBe('\u0000');
        expect(bytes(key('[', 'BracketLeft', { ctrlKey: true }))).toBe(ESC);
        expect(bytes(key('\\', 'Backslash', { ctrlKey: true }))).toBe('\u001c');
        expect(bytes(key(']', 'BracketRight', { ctrlKey: true }))).toBe('\u001d');
        expect(bytes(key('3', 'Digit3', { ctrlKey: true }))).toBe(ESC);
        expect(bytes(key('8', 'Digit8', { ctrlKey: true }))).toBe('\u007f');
        expect(bytes(key('_', 'Minus', { ctrlKey: true, shiftKey: true }))).toBe('\u001f');
        expect(bytes(key('@', 'Digit2', { ctrlKey: true, shiftKey: true }))).toBe('\u0000');
    });

    it('treats Option as Meta only when asked, or off macOS', () => {
        expect(bytes(key('å', 'KeyA', { altKey: true }))).toBeUndefined();
        const meta = { ...normal, macOptionIsMeta: true };
        expect(bytes(key('a', 'KeyA', { altKey: true }), meta)).toBe(`${ESC}a`);
        expect(bytes(key('A', 'KeyA', { altKey: true, shiftKey: true }), meta)).toBe(`${ESC}A`);
        expect(bytes(key('.', 'Period', { altKey: true }), meta)).toBe(`${ESC}.`);
        expect(bytes(key('>', 'Period', { altKey: true, shiftKey: true }), meta)).toBe(`${ESC}>`);
        expect(bytes(key(' ', 'Space', { altKey: true }), { ...normal, isMac: false })).toBe(`${ESC} `);
        expect(bytes(key('Dead', 'KeyN', { altKey: true }), meta)).toBe(`${ESC}n`);
    });

    it('leaves printable keys and Cmd shortcuts to text input and the app', () => {
        expect(encodeKey(key('a', 'KeyA'), normal)).toEqual({ kind: 'none' });
        expect(encodeKey(key('é', 'KeyE'), normal)).toEqual({ kind: 'none' });
        expect(encodeKey(key('c', 'KeyC', { metaKey: true }), normal)).toEqual({ kind: 'none' });
        expect(encodeKey(key('Shift', 'ShiftLeft', { shiftKey: true }), normal)).toEqual({ kind: 'none' });
    });
});

describe('encodeKey with the kitty keyboard protocol disambiguate level (US-1.11, D-30)', () => {
    const kitty = { ...normal, kittyFlags: 1 };
    const linux = { ...kitty, isMac: false };

    it('sends modified Enter, Tab and Backspace as CSI u, and the plain keys as before', () => {
        expect(bytes(key('Enter', 'Enter', { shiftKey: true }), kitty)).toBe(`${ESC}[13;2u`);
        expect(bytes(key('Enter', 'Enter', { ctrlKey: true }), kitty)).toBe(`${ESC}[13;5u`);
        expect(bytes(key('Enter', 'Enter', { altKey: true }), kitty)).toBe(`${ESC}[13;3u`);
        expect(bytes(key('Enter', 'Enter'), kitty)).toBe('\r');
        expect(bytes(key('Tab', 'Tab', { shiftKey: true }), kitty)).toBe(`${ESC}[9;2u`);
        expect(bytes(key('Tab', 'Tab'), kitty)).toBe('\t');
        expect(bytes(key('Backspace', 'Backspace', { ctrlKey: true }), kitty)).toBe(`${ESC}[127;5u`);
        expect(bytes(key('Backspace', 'Backspace'), kitty)).toBe('\u007f');
    });

    it('sends Escape as CSI 27 u, so it can never be mistaken for the start of a sequence', () => {
        expect(bytes(key('Escape', 'Escape'), kitty)).toBe(`${ESC}[27u`);
        expect(bytes(key('Escape', 'Escape', { shiftKey: true }), kitty)).toBe(`${ESC}[27;2u`);
    });

    it('sends Ctrl and Alt combinations with the unshifted key code', () => {
        expect(bytes(key('c', 'KeyC', { ctrlKey: true }), kitty)).toBe(`${ESC}[99;5u`);
        expect(bytes(key('A', 'KeyA', { ctrlKey: true, shiftKey: true }), kitty)).toBe(`${ESC}[97;6u`);
        expect(bytes(key('!', 'Digit1', { ctrlKey: true, shiftKey: true }), kitty)).toBe(`${ESC}[49;6u`);
        expect(bytes(key('x', 'KeyX', { altKey: true }), linux)).toBe(`${ESC}[120;3u`);
        expect(bytes(key('a', 'KeyA', { ctrlKey: true, altKey: true }), linux)).toBe(`${ESC}[97;7u`);
        expect(bytes(key(' ', 'Space', { ctrlKey: true }), kitty)).toBe(`${ESC}[32;5u`);
    });

    it('leaves text keys, Option characters on the Mac and Cmd shortcuts alone', () => {
        expect(bytes(key('a', 'KeyA'), kitty)).toBeUndefined();
        expect(bytes(key('A', 'KeyA', { shiftKey: true }), kitty)).toBeUndefined();
        expect(bytes(key('≈', 'KeyX', { altKey: true }), kitty)).toBeUndefined();
        expect(bytes(key('Enter', 'Enter', { metaKey: true }), kitty)).toBeUndefined();
    });

    it('keeps the legacy function key forms, except F3 with modifiers, whose CSI R would read as a cursor report', () => {
        expect(bytes(key('ArrowUp', 'ArrowUp'), kitty)).toBe(`${ESC}[A`);
        expect(bytes(key('ArrowUp', 'ArrowUp', { shiftKey: true }), kitty)).toBe(`${ESC}[1;2A`);
        expect(bytes(key('F3', 'F3', { ctrlKey: true }), kitty)).toBe(`${ESC}[13;5~`);
        expect(bytes(key('F5', 'F5'), kitty)).toBe(`${ESC}[15~`);
    });

    it('changes nothing while no program asked for it', () => {
        expect(bytes(key('Enter', 'Enter', { shiftKey: true }))).toBe('\r');
        expect(bytes(key('Escape', 'Escape'))).toBe(ESC);
    });
});

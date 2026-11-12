import { describe, expect, it } from 'vitest';
import { encodeKey, type KeyInput } from './key-encoder';

const ESC = '\u001b';

function key(name: string, code = '', modifiers: Partial<KeyInput> = {}): KeyInput {
    return { key: name, code, altKey: false, ctrlKey: false, shiftKey: false, metaKey: false, ...modifiers };
}

const normal = { applicationCursorKeys: false, macOptionIsMeta: false, isMac: true };
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

import { Terminal } from '@xterm/xterm';
import { afterEach, describe, expect, it } from 'vitest';
import { KittyKeyboard } from './kitty-keyboard';

const terminals: Terminal[] = [];

afterEach(() => {
    for (const terminal of terminals.splice(0)) {
        terminal.dispose();
    }
});

function setup() {
    const terminal = new Terminal({ allowProposedApi: true });
    terminals.push(terminal);
    const keyboard = new KittyKeyboard(terminal);
    const write = (data: string) => new Promise<void>((resolve) => terminal.write(data, resolve));
    return { keyboard, write };
}

describe('KittyKeyboard: the flags programs push (kitty keyboard protocol, D-30)', () => {
    it('pushes and pops flags, starting from none', async () => {
        const { keyboard, write } = setup();
        expect(keyboard.flags).toBe(0);
        await write('\u001b[>1u');
        expect(keyboard.flags).toBe(1);
        await write('\u001b[>3u');
        expect(keyboard.flags).toBe(3);
        await write('\u001b[<u');
        expect(keyboard.flags).toBe(1);
        await write('\u001b[<5u');
        expect(keyboard.flags).toBe(0);
    });

    it('sets, adds and removes bits of the current flags', async () => {
        const { keyboard, write } = setup();
        await write('\u001b[=5u');
        expect(keyboard.flags).toBe(5);
        await write('\u001b[=2;2u');
        expect(keyboard.flags).toBe(7);
        await write('\u001b[=1;3u');
        expect(keyboard.flags).toBe(6);
    });

    it('keeps the main and alternate screens apart', async () => {
        const { keyboard, write } = setup();
        await write('\u001b[>1u\u001b[?1049h');
        expect(keyboard.flags).toBe(0);
        await write('\u001b[>3u');
        expect(keyboard.flags).toBe(3);
        await write('\u001b[?1049l');
        expect(keyboard.flags).toBe(1);
    });

    it('evicts the oldest entry from a full stack, and forgets everything on a full reset', async () => {
        const { keyboard, write } = setup();
        await write('\u001b[>1u'.repeat(40));
        await write('\u001b[<u'.repeat(39));
        expect(keyboard.flags).toBe(0);
        await write('\u001b[>1u\u001bc');
        expect(keyboard.flags).toBe(0);
    });
});

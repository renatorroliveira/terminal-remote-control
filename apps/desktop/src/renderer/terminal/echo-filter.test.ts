import { describe, expect, it } from 'vitest';
import { EchoFilter } from './echo-filter';

function filterAt(start = 0): { readonly filter: EchoFilter; readonly at: (ms: number) => void } {
    let now = start;
    const filter = new EchoFilter(() => now);
    return { filter, at: (ms) => (now = ms) };
}

describe('EchoFilter: the shell echo of typed characters is not spoken again (A11Y-01.4, R9)', () => {
    it('removes the typed characters from the start of new text', () => {
        const { filter } = filterAt();
        filter.typed('ls');
        expect(filter.strip('ls')).toBe('');
    });

    it('removes an echo that arrives in parts', () => {
        const { filter } = filterAt();
        filter.typed('l');
        filter.typed('s');
        expect(filter.strip('l')).toBe('');
        expect(filter.strip('s')).toBe('');
    });

    it('keeps what follows the echo, such as a completion', () => {
        const { filter } = filterAt();
        filter.typed('ca');
        expect(filter.strip('cat file.txt')).toBe('t file.txt');
    });

    it('keeps text the user did not type and forgets the typing it did not match', () => {
        const { filter } = filterAt();
        filter.typed('secret');
        expect(filter.strip('Password incorrect')).toBe('Password incorrect');
        expect(filter.strip('secret')).toBe('secret');
    });

    it('ignores control input such as Enter and arrow keys', () => {
        const { filter } = filterAt();
        filter.typed('ls');
        filter.typed('\r');
        filter.typed('\u001b[A');
        expect(filter.strip('ls')).toBe('');
    });

    it('forgets a character erased with Backspace before its echo arrived', () => {
        const { filter } = filterAt();
        filter.typed('lx');
        filter.typed('\u007f');
        filter.typed('s');
        expect(filter.strip('ls')).toBe('');
    });

    it('matches whole characters, such as emoji and composed text', () => {
        const { filter } = filterAt();
        filter.typed('日本👍');
        expect(filter.strip('日本👍 ok')).toBe(' ok');
    });

    it('forgets typing whose echo has not come within two seconds', () => {
        const { filter, at } = filterAt();
        filter.typed('q');
        at(2_001);
        expect(filter.strip('q')).toBe('q');
    });
});

describe('EchoFilter: bounded memory (NFR-09)', () => {
    it('forgets old typing as new typing arrives, even when no output is ever read, and keeps at most 4,096', () => {
        let now = 0;
        const filter = new EchoFilter(() => now);
        filter.typed('abc');
        now = 2_500;
        filter.typed('d');
        expect(filter.pending).toBe(1);
        filter.typed('x'.repeat(10_000));
        expect(filter.pending).toBe(4_096);
    });
});

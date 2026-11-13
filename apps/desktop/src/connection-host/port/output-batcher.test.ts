import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutputBatcher } from './output-batcher';

function recorder() {
    const flushed: [string, number, string][] = [];
    const batcher = new OutputBatcher((hostId, stream, data) =>
        flushed.push([hostId, stream, Buffer.from(data).toString()]),
    );
    return { flushed, batcher };
}

describe('OutputBatcher (NFR-02, NFR-03)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('posts output that arrives while idle at once, so a keystroke echo never waits', () => {
        const { flushed, batcher } = recorder();
        batcher.add('h1', 1, Buffer.from('a'));
        expect(flushed).toEqual([['h1', 1, 'a']]);
        vi.advanceTimersByTime(6);
        batcher.add('h1', 1, Buffer.from('b'));
        expect(flushed).toEqual([
            ['h1', 1, 'a'],
            ['h1', 1, 'b'],
        ]);
    });

    it('joins what follows per host stream for 5 ms, for as long as output keeps coming', () => {
        const { flushed, batcher } = recorder();
        batcher.add('h1', 1, Buffer.from('a'));
        batcher.add('h1', 1, Buffer.from('bc'));
        batcher.add('h1', 1, Buffer.from('d'));
        batcher.add('h2', 1, Buffer.from('x'));
        vi.advanceTimersByTime(4);
        expect(flushed).toEqual([['h1', 1, 'a']]);
        vi.advanceTimersByTime(1);
        batcher.add('h1', 1, Buffer.from('e'));
        expect(flushed).toEqual([
            ['h1', 1, 'a'],
            ['h1', 1, 'bcd'],
            ['h2', 1, 'x'],
        ]);
        vi.advanceTimersByTime(5);
        expect(flushed.at(-1)).toEqual(['h1', 1, 'e']);
    });

    it('flushes at once on request, so control messages never overtake output', () => {
        const { flushed, batcher } = recorder();
        batcher.add('h', 3, Buffer.from('head'));
        batcher.add('h', 3, Buffer.from('tail'));
        batcher.flushAll();
        expect(flushed.map(([, , text]) => text)).toEqual(['head', 'tail']);
        vi.advanceTimersByTime(10);
        expect(flushed.map(([, , text]) => text)).toEqual(['head', 'tail']);
    });
});

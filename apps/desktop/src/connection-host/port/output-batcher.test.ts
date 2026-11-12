import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutputBatcher } from './output-batcher';

describe('OutputBatcher', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('joins output per host stream for about 5 ms', () => {
        const flushed: [string, number, string][] = [];
        const batcher = new OutputBatcher((hostId, stream, data) =>
            flushed.push([hostId, stream, Buffer.from(data).toString()]),
        );
        batcher.add('h1', 1, Buffer.from('ab'));
        batcher.add('h1', 1, Buffer.from('cd'));
        batcher.add('h2', 1, Buffer.from('x'));
        vi.advanceTimersByTime(4);
        expect(flushed).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(flushed).toEqual([
            ['h1', 1, 'abcd'],
            ['h2', 1, 'x'],
        ]);
    });

    it('flushes at once on request, so control messages never overtake output', () => {
        const flushed: string[] = [];
        const batcher = new OutputBatcher((_hostId, _stream, data) => flushed.push(Buffer.from(data).toString()));
        batcher.add('h', 3, Buffer.from('tail'));
        batcher.flushAll();
        expect(flushed).toEqual(['tail']);
        vi.advanceTimersByTime(10);
        expect(flushed).toEqual(['tail']);
    });
});

import { describe, expect, it } from 'vitest';
import { tuneInputLatency } from './latency-switches';

describe('tuneInputLatency (NFR-02, S13)', () => {
    it('stops Chromium holding back other tasks after a key press until the next frame', () => {
        const switches: [string, string | undefined][] = [];
        tuneInputLatency({ appendSwitch: (name, value) => switches.push([name, value]) });
        expect(switches).toEqual([['disable-features', 'DeferRendererTasksAfterInput']]);
    });
});

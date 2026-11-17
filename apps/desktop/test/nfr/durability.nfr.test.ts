import { afterAll, describe, expect, it } from 'vitest';
import { closeLiveHosts, connectLive, ssh, testHostsMissing } from './live-host';
import { record } from './stats';

const HOST = 'trc-ubuntu';
const MARKERS = 40;
const POLL_MS = 100;

afterAll(() => {
    closeLiveHosts();
});

/**
 * The newest marker the session's scrollback file on the host holds: records are appended in order, so every marker
 * up to it is on disk.
 */
function newestOnDisk(root: string, session: string): number {
    const file = `$HOME/${root}/sessions/${session}/scrollback.log`;
    const found = ssh(HOST, `grep -ao 'trc-durable-[0-9]*-done' ${file} 2>/dev/null | tail -n 1`).trim();
    const match = /trc-durable-(\d+)-done$/.exec(found.split('\n').at(-1) ?? '');
    return match === null ? 0 : Number(match[1]);
}

describe.skipIf(testHostsMissing() !== undefined)('NFR-08: output reaches the disk within 5 s', () => {
    it('saves each marker of a flood of output to the session’s scrollback file soon after the app sees it', async () => {
        const host = await connectLive(HOST);
        const session = await host.session();
        const shown = new Map<number, number>();
        for (let marker = 1; marker <= MARKERS; marker += 1) {
            void session.next(`trc-durable-${marker}-done`, 120_000).then((at) => shown.set(marker, at));
        }
        const flood = "head -c 30000 /dev/zero | tr '\\0' x | fold -w 100";
        session.type(`for i in $(seq 1 ${MARKERS}); do echo "trc-durable-$i-d""one"; ${flood}; sleep 0.25; done\r`);
        const saved = new Map<number, number>();
        const deadline = performance.now() + 120_000;
        while (saved.size < MARKERS && performance.now() < deadline) {
            const newest = newestOnDisk(host.root, session.id);
            const now = performance.now();
            for (let marker = saved.size + 1; marker <= newest; marker += 1) {
                saved.set(marker, now);
            }
            await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
        const lags = [...saved].map(([marker, at]) => at - (shown.get(marker) ?? at));
        expect(saved.size).toBe(MARKERS);
        const worst = Math.max(...lags);
        record({
            id: 'NFR-08',
            what: `${HOST}: output to its fdatasync'ed copy on disk, largest of ${MARKERS} markers over a 1.2 MB flood`,
            value: worst / 1_000,
            unit: 's',
            target: '≤ 5 s',
        });
        expect(worst).toBeLessThanOrEqual(5_000);
    });
});

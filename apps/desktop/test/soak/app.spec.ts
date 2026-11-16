import { expect, type Locator, test } from '@playwright/test';
import {
    launchWithTestHosts,
    openTerminal,
    removeInstall,
    rowTexts,
    scratchInstallRoot,
    type TestHostApp,
    testHostsMissing,
} from '../e2e/support/test-host';
import { ssh } from '../nfr/live-host';
import { record } from '../nfr/stats';
import { soakCycles } from './soak';

/**
 * Real app launches that end in a quit or a crash, 50 of each (NFR-11, P-25), in the background with a scratch TRC
 * home: each launch restores the session from the last, finds what was typed before, and runs what is typed now,
 * and the session's shell keeps its PID on the host.
 */
const CYCLES = soakCycles('TRC_SOAK_APP_CYCLES', 50);
const HOST = 'trc-ubuntu';
const missing = testHostsMissing();

async function screenText(terminal: Locator): Promise<string> {
    return (await rowTexts(terminal)).join('\n');
}

function alive(pid: string): boolean {
    return ssh(HOST, `kill -0 ${pid} 2>/dev/null && echo alive || echo gone`).trim() === 'alive';
}

/** Types a marker into the terminal and waits for the shell to run it. */
async function mark(launched: TestHostApp, terminal: Locator, marker: string): Promise<void> {
    await terminal.focus();
    await launched.window.keyboard.type(`echo ${marker.slice(0, -1)}''${marker.slice(-1)}`);
    await launched.window.keyboard.press('Enter');
    await expect.poll(() => rowTexts(terminal), { timeout: 15_000 }).toContain(marker);
}

/** Launches again with the same TRC home and opens the restored session. */
async function relaunch(root: string, scratch: string): Promise<{ launched: TestHostApp; terminal: Locator }> {
    const launched = await launchWithTestHosts(root, { scratch });
    await launched.window.getByRole('treeitem', { name: /, Running$/ }).click({ timeout: 60_000 });
    const terminal = launched.window.getByRole('textbox', { name: new RegExp(`, ${HOST}$`) });
    await terminal.waitFor({ timeout: 30_000 });
    return { launched, terminal };
}

/** Ends the app as a quit does, or as a crash does. */
async function end(launched: TestHostApp, how: 'quit' | 'crash'): Promise<void> {
    if (how === 'quit') {
        await launched.app.close();
        return;
    }
    const closed = launched.app.waitForEvent('close');
    await launched.app.evaluate(() => process.crash()).catch(() => undefined);
    await closed;
}

test.describe('soak: the app quits and crashes (NFR-11, US-2.1.1)', () => {
    test.skip(missing !== undefined, missing);

    test(`launches ${CYCLES} times ending in a quit and ${CYCLES} ending in a crash, and the session stays`, async () => {
        const root = scratchInstallRoot();
        try {
            const first = await launchWithTestHosts(root);
            const terminal = await openTerminal(first.window, HOST);
            await expect.poll(() => screenText(terminal), { timeout: 30_000 }).toMatch(/[$#] *$/m);
            await mark(first, terminal, 'pid-is-ready');
            await first.window.keyboard.type('echo "pid=$$"');
            await first.window.keyboard.press('Enter');
            await expect.poll(async () => /^pid=\d+$/m.test(await screenText(terminal))).toBe(true);
            const pid = /^pid=(\d+)$/m.exec(await screenText(terminal))?.[1] ?? '';
            await end(first, 'quit');
            for (let cycle = 1; cycle <= 2 * CYCLES; cycle += 1) {
                const how = cycle % 2 === 0 ? 'crash' : 'quit';
                const { launched, terminal: restored } = await relaunch(root, first.scratch);
                const previous = cycle === 1 ? 'pid-is-ready' : `app-${cycle - 1}-ok`;
                await expect.poll(() => rowTexts(restored), { timeout: 30_000 }).toContain(previous);
                await mark(launched, restored, `app-${cycle}-ok`);
                await end(launched, how);
                expect(alive(pid), `cycle ${cycle}, after a ${how}`).toBe(true);
            }
            record({
                id: 'NFR-11',
                what: `app launches on ${HOST}: sessions lost in ${CYCLES} quits and ${CYCLES} crashes`,
                value: 0,
                unit: '',
                target: '0',
            });
        } finally {
            removeInstall(HOST, root);
        }
    });
});

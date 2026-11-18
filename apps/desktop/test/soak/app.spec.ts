import { existsSync } from 'node:fs';
import { type ElectronApplication, expect, type Locator, type Page, test } from '@playwright/test';
import {
    alive as aliveHere,
    LOCAL_DAEMON,
    launchLocal,
    localShell,
    removeLocalDaemon,
    scratchLocal,
} from '../e2e/support/local-host';
import {
    launchWithTestHosts,
    openTerminal,
    removeInstall,
    rowTexts,
    scratchInstallRoot,
    testHostsMissing,
} from '../e2e/support/test-host';
import { ssh } from '../nfr/live-host';
import { record } from '../nfr/stats';
import { soakCycles } from './soak';

/**
 * Real app launches that end in a quit or a crash, 50 of each (NFR-11, P-25), in the background with a scratch TRC
 * home, with a session on a Linux test host and with one on This computer (E4): each launch restores the session from
 * the last, finds what was typed before, and runs what is typed now, and the session's shell keeps its PID.
 */
const CYCLES = soakCycles('TRC_SOAK_APP_CYCLES', 50);
const HOST = 'trc-ubuntu';
const missing = testHostsMissing();

/** A launched app the soak drives. */
interface Launched {
    readonly app: ElectronApplication;
    readonly window: Page;
}

/** Where the soak's session runs: how the app launches, opens the session, and tells whether its shell lives. */
interface SoakTarget {
    /** The session's host, as the results name it. */
    readonly name: string;
    /** Launches the app for the first time, opens a new session and returns its shell's PID. */
    readonly first: () => Promise<{ readonly launched: Launched; readonly terminal: Locator; readonly pid: number }>;
    /** Launches the app again with the same TRC home and opens the restored session. */
    readonly relaunch: () => Promise<{ readonly launched: Launched; readonly terminal: Locator }>;
    readonly alive: (pid: number) => boolean;
    /** Removes the daemon and its install. */
    readonly remove: () => void;
}

async function screenText(terminal: Locator): Promise<string> {
    return (await rowTexts(terminal)).join('\n');
}

/** Types a marker into the terminal and waits for the shell to run it. */
async function mark(launched: Launched, terminal: Locator, marker: string): Promise<void> {
    await terminal.focus();
    await launched.window.keyboard.type(`echo ${marker.slice(0, -1)}''${marker.slice(-1)}`);
    await launched.window.keyboard.press('Enter');
    await expect.poll(() => rowTexts(terminal), { timeout: 15_000 }).toContain(marker);
}

/** Ends the app as a quit does, or as a crash does. */
async function end(launched: Launched, how: 'quit' | 'crash'): Promise<void> {
    if (how === 'quit') {
        await launched.app.close();
        return;
    }
    const closed = launched.app.waitForEvent('close');
    await launched.app.evaluate(() => process.crash()).catch(() => undefined);
    await closed;
}

/** Opens the restored running session in a launched app; its terminal's name ends with `host`. */
async function openRestored(launched: Launched, host: string): Promise<Locator> {
    await launched.window.getByRole('treeitem', { name: /, Running$/ }).click({ timeout: 60_000 });
    const terminal = launched.window.getByRole('textbox', { name: new RegExp(`, ${host}$`) });
    await terminal.waitFor({ timeout: 30_000 });
    return terminal;
}

/** A session on the Linux test host, its daemon in a scratch install root. */
function onTestHost(): SoakTarget {
    const root = scratchInstallRoot();
    let scratch = '';
    return {
        name: HOST,
        first: async () => {
            const launched = await launchWithTestHosts(root);
            scratch = launched.scratch;
            const terminal = await openTerminal(launched.window, HOST);
            await expect.poll(() => screenText(terminal), { timeout: 30_000 }).toMatch(/[$#] *$/m);
            await mark(launched, terminal, 'pid-is-ready');
            await launched.window.keyboard.type('echo "pid=$$"');
            await launched.window.keyboard.press('Enter');
            await expect.poll(async () => /^pid=\d+$/m.test(await screenText(terminal))).toBe(true);
            const pid = Number(/^pid=(\d+)$/m.exec(await screenText(terminal))?.[1] ?? 0);
            return { launched, terminal, pid };
        },
        relaunch: async () => {
            const launched = await launchWithTestHosts(root, { scratch });
            return { launched, terminal: await openRestored(launched, HOST) };
        },
        alive: (pid) => ssh(HOST, `kill -0 ${pid} 2>/dev/null && echo alive || echo gone`).trim() === 'alive',
        remove: () => removeInstall(HOST, root),
    };
}

/** A session on This computer, its daemon a temporary LaunchAgent in a scratch TRC home (P-58). */
function onThisComputer(): SoakTarget {
    const local = scratchLocal();
    return {
        name: 'This computer',
        first: async () => {
            const launched = await launchLocal(local);
            const pid = await localShell(launched.window);
            const terminal = launched.window.getByRole('textbox', { name: /, This computer$/ });
            await mark(launched, terminal, 'pid-is-ready');
            return { launched, terminal, pid };
        },
        relaunch: async () => {
            const launched = await launchLocal(local);
            return { launched, terminal: await openRestored(launched, 'This computer') };
        },
        alive: aliveHere,
        remove: () => removeLocalDaemon(local.trcHome),
    };
}

/** Quits and crashes the app `CYCLES` times each with `target`'s session, checking it after each. */
async function soakApp(target: SoakTarget): Promise<void> {
    try {
        const { launched: first, pid } = await target.first();
        await end(first, 'quit');
        for (let cycle = 1; cycle <= 2 * CYCLES; cycle += 1) {
            const how = cycle % 2 === 0 ? 'crash' : 'quit';
            const { launched, terminal } = await target.relaunch();
            const previous = cycle === 1 ? 'pid-is-ready' : `app-${cycle - 1}-ok`;
            await expect.poll(() => rowTexts(terminal), { timeout: 30_000 }).toContain(previous);
            await mark(launched, terminal, `app-${cycle}-ok`);
            await end(launched, how);
            expect(target.alive(pid), `cycle ${cycle}, after a ${how}`).toBe(true);
        }
        record({
            id: 'NFR-11',
            what: `app launches on ${target.name}: sessions lost in ${CYCLES} quits and ${CYCLES} crashes`,
            value: 0,
            unit: '',
            target: '0',
        });
    } finally {
        target.remove();
    }
}

test.describe('soak: the app quits and crashes (NFR-11, US-2.1.1)', () => {
    test.skip(missing !== undefined, missing);

    test(`launches ${CYCLES} times ending in a quit and ${CYCLES} ending in a crash, and the session stays`, async () => {
        await soakApp(onTestHost());
    });
});

test.describe('soak: the app quits and crashes with a session on This computer (NFR-11, US-4.3)', () => {
    test.skip(process.platform !== 'darwin' || !existsSync(LOCAL_DAEMON), 'needs macOS and pnpm build:daemon');

    test(`launches ${CYCLES} times ending in a quit and ${CYCLES} ending in a crash, and the local session stays`, async () => {
        await soakApp(onThisComputer());
    });
});

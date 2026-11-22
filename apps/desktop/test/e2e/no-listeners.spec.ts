import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { electronMainPid, killMatching, openSockets, processTree } from '../test-platform';
import { LOCAL_DAEMON, launchLocal, localShell, removeLocalDaemon, scratchLocal } from './support/local-host';
import {
    launchWithTestHosts,
    openTerminal,
    recordSpeech,
    removeInstall,
    rowTexts,
    scratchInstallRoot,
    spokenTexts,
    testHostsMissing,
} from './support/test-host';

const missing = testHostsMissing();

/** Whether a loopback listener is a debugging endpoint, as Chromium's DevTools and Node's inspector answer. */
async function isDebuggingEndpoint(name: string): Promise<boolean> {
    try {
        const reply = await fetch(`http://${name}/json/version`, { signal: AbortSignal.timeout(2_000) });
        const version = (await reply.json()) as { readonly 'Protocol-Version'?: unknown };
        return typeof version['Protocol-Version'] === 'string';
    } catch {
        return false;
    }
}

/** Whether the built main process is the test build, the only one that keeps Playwright's debugging port (P-14). */
function isTestBuild(): boolean {
    return readFileSync(join(import.meta.dirname, '../../out/main/index.js'), 'utf8').includes('TRC_TEST_');
}

/** Checks that no app process or ssh child listens or holds a UDP socket, beside the test build's debugging ports. */
async function expectNoListeners(app: ElectronApplication): Promise<void> {
    const main = electronMainPid(app.process().pid ?? 0);
    const tree = processTree(main);
    const listening = openSockets(tree, 'tcp-listen');
    const udp = openSockets(tree, 'udp');
    expect(tree.length).toBeGreaterThan(4);
    expect(isTestBuild()).toBe(true);
    expect(listening.length).toBeGreaterThan(0);
    expect(udp).toEqual([]);
    expect(listening.filter((socket) => socket.pid !== main)).toEqual([]);
    expect(listening.every((socket) => socket.name.startsWith('127.0.0.1:'))).toBe(true);
    const debugging = await Promise.all(listening.map((socket) => isDebuggingEndpoint(socket.name)));
    expect(debugging.every(Boolean)).toBe(true);
}

/** The processes run from a daemon installed in `trcHome`: its core and every holder (US-4.1). */
function daemonProcesses(trcHome: string): readonly number[] {
    try {
        const out = execFileSync('pgrep', ['-f', `${realpathSync(trcHome)}/versions/`], { encoding: 'utf8' });
        return out.split('\n').filter(Boolean).map(Number);
    } catch {
        return [];
    }
}

/** Whether the app has announced that it reconnected. */
async function saidReconnected(window: Page): Promise<boolean> {
    return (await spokenTexts(window)).some((text) => text.includes('Reconnected'));
}

test.describe('no listening sockets after connect, create and reconnect (SEC-01.3)', () => {
    test.skip(missing !== undefined, missing);

    test('opens none in any app process or ssh child once a session runs on a host, nor after a reconnect', async () => {
        const root = scratchInstallRoot();
        const { app, window, home } = await launchWithTestHosts(root);
        try {
            const terminal = await openTerminal(window, 'trc-ubuntu');
            await terminal.focus();
            await expect
                .poll(async () => (await rowTexts(terminal)).join('\n'), { timeout: 30_000 })
                .toMatch(/[$#%] *$/m);
            await window.keyboard.type('echo trc-listeners');
            await window.keyboard.press('Enter');
            await expect.poll(() => rowTexts(terminal)).toContain('trc-listeners');
            await expectNoListeners(app);
            await recordSpeech(window);
            expect(killMatching([basename(dirname(home)), 'known_hosts'])).toBeGreaterThan(0);
            await expect.poll(() => saidReconnected(window), { timeout: 60_000 }).toBe(true);
            await expectNoListeners(app);
        } finally {
            await app.close();
            removeInstall('trc-ubuntu', root);
        }
    });
});

test.describe('no listening sockets on This computer (SEC-01.1, US-4.1)', () => {
    test.skip(process.platform !== 'darwin' || !existsSync(LOCAL_DAEMON), 'needs macOS and pnpm build:daemon');

    test('opens none in any app process, nor in the local core or its holders', async () => {
        const local = scratchLocal();
        try {
            const { app, window } = await launchLocal(local);
            await localShell(window);
            await expectNoListeners(app);
            const daemon = daemonProcesses(local.trcHome);
            expect(daemon.length, 'the core and one holder').toBeGreaterThanOrEqual(2);
            expect([...openSockets(daemon, 'tcp-listen'), ...openSockets(daemon, 'udp')]).toEqual([]);
            await app.close();
            const after = daemonProcesses(local.trcHome);
            expect([...openSockets(after, 'tcp-listen'), ...openSockets(after, 'udp')]).toEqual([]);
        } finally {
            removeLocalDaemon(local.trcHome);
        }
    });
});

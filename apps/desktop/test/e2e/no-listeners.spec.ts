import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
    launchWithTestHosts,
    openTerminal,
    removeInstall,
    rowTexts,
    scratchInstallRoot,
    testHostsMissing,
} from './support/test-host';

const missing = testHostsMissing();

interface OpenSocket {
    readonly pid: number;
    readonly name: string;
}

/** `root` and every process it started. */
function processTree(root: number): readonly number[] {
    const pairs = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' })
        .split('\n')
        .map((line) => line.trim().split(/\s+/).map(Number))
        .filter((pair): pair is [number, number] => pair.length === 2 && pair.every(Number.isInteger));
    const tree = [root];
    for (let index = 0; index < tree.length; index += 1) {
        tree.push(...pairs.filter(([, parent]) => parent === tree[index]).map(([pid]) => pid));
    }
    return tree;
}

/** The listening TCP sockets and the UDP sockets `pids` own, from lsof's machine-readable output. */
function sockets(pids: readonly number[], filter: readonly string[]): readonly OpenSocket[] {
    let out = '';
    try {
        out = execFileSync('lsof', ['-nP', '-a', '-p', pids.join(','), ...filter, '-F', 'pn'], { encoding: 'utf8' });
    } catch (error) {
        out = (error as { readonly stdout?: string }).stdout ?? '';
    }
    let pid = 0;
    return out.split('\n').flatMap((line) => {
        if (line.startsWith('p')) {
            pid = Number(line.slice(1));
            return [];
        }
        return line.startsWith('n') ? [{ pid, name: line.slice(1) }] : [];
    });
}

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

test.describe('no listening sockets after connect and create (SEC-01.3)', () => {
    test.skip(missing !== undefined, missing);

    test('opens none in any app process or ssh child once a session runs on a host, beside the test build’s debugging ports', async () => {
        const root = scratchInstallRoot();
        const { app, window } = await launchWithTestHosts(root);
        try {
            const terminal = await openTerminal(window, 'trc-ubuntu');
            await terminal.focus();
            await expect
                .poll(async () => (await rowTexts(terminal)).join('\n'), { timeout: 30_000 })
                .toMatch(/[$#] *$/m);
            await window.keyboard.type('echo trc-listeners');
            await window.keyboard.press('Enter');
            await expect.poll(() => rowTexts(terminal)).toContain('trc-listeners');
            const main = app.process().pid ?? 0;
            const tree = processTree(main);
            const listening = sockets(tree, ['-iTCP', '-sTCP:LISTEN']);
            const udp = sockets(tree, ['-iUDP']);
            expect(tree.length).toBeGreaterThan(4);
            expect(isTestBuild()).toBe(true);
            expect(listening.length).toBeGreaterThan(0);
            expect(udp).toEqual([]);
            expect(listening.filter((socket) => socket.pid !== main)).toEqual([]);
            expect(listening.every((socket) => socket.name.startsWith('127.0.0.1:'))).toBe(true);
            const debugging = await Promise.all(listening.map((socket) => isDebuggingEndpoint(socket.name)));
            expect(debugging.every(Boolean)).toBe(true);
        } finally {
            await app.close();
            removeInstall('trc-ubuntu', root);
        }
    });
});

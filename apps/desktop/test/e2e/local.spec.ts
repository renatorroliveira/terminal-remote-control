import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, skipFirstQuitNotice } from './support/launch';
import { alive, LOCAL_DAEMON, launchLocal, localShell, removeLocalDaemon, scratchLocal } from './support/local-host';
import { rowTexts } from './support/test-host';

test.describe('This computer (US-4.1, US-4.2)', () => {
    test.skip(process.platform !== 'darwin' || !existsSync(LOCAL_DAEMON), 'needs macOS and pnpm build:daemon');
    const scratch = { trcHome: '' };
    test.afterEach(() => {
        removeLocalDaemon(scratch.trcHome);
    });

    test('installs its daemon at launch, lists it first, and runs a local shell without SSH', async () => {
        const local = scratchLocal();
        scratch.trcHome = local.trcHome;
        skipFirstQuitNotice(local.trcHome);
        const app = await launchApp([], { TRC_HOME: local.trcHome, TRC_TEST_LOCAL_HOME: local.localHome });
        const window = await app.firstWindow();
        const hosts = window.getByRole('list', { name: 'Known hosts' });
        await expect(hosts.getByRole('listitem').first()).toContainText('This computer', { timeout: 20_000 });
        await window.getByRole('button', { name: 'Disconnect This computer' }).waitFor({ timeout: 60_000 });
        await window.getByRole('button', { name: 'New session on This computer' }).click();
        const terminal = window.getByRole('textbox', { name: /, This computer$/ });
        await terminal.waitFor({ timeout: 30_000 });
        await terminal.focus();
        await window.keyboard.type('echo "local-$((6*7))"');
        await window.keyboard.press('Enter');
        await expect.poll(() => rowTexts(terminal), { timeout: 15_000 }).toContain('local-42');
        await app.close();
    });

    test('a quit, a crash, a force-kill and a killed daemon end no local session (US-4.3.1, US-4.3.2)', async () => {
        test.setTimeout(240_000);
        const local = scratchLocal();
        scratch.trcHome = local.trcHome;
        const first = await launchLocal(local);
        const pid = await localShell(first.window);
        await expect.poll(() => cachedLocalSessions(local.trcHome), { timeout: 15_000 }).toBe(1);
        await first.app.close();
        expect(alive(pid)).toBe(true);
        const crashing = await launchLocal(local);
        const crashed = crashing.app.waitForEvent('close');
        await crashing.app.evaluate(() => process.crash()).catch(() => undefined);
        await crashed;
        expect(alive(pid)).toBe(true);
        const killed = await launchLocal(local);
        const gone = killed.app.waitForEvent('close');
        process.kill(killed.app.process().pid ?? 0, 'SIGKILL');
        await gone;
        expect(alive(pid)).toBe(true);
        const last = await launchLocal(local);
        const core = Number(readFileSync(join(local.trcHome, 'run/core.lock'), 'utf8').split('\n')[0]);
        process.kill(core, 'SIGKILL');
        await last.window.getByRole('button', { name: 'Disconnect This computer' }).waitFor({ timeout: 90_000 });
        await expect
            .poll(() => Number(readFileSync(join(local.trcHome, 'run/core.lock'), 'utf8').split('\n')[0]), {
                timeout: 30_000,
            })
            .not.toBe(core);
        expect(alive(pid)).toBe(true);
        await last.window
            .getByRole('treeitem', { name: /, Running$/ })
            .first()
            .click();
        const terminal = last.window.getByRole('textbox', { name: /, This computer$/ });
        await expect
            .poll(async () => (await rowTexts(terminal)).join('\n'), { timeout: 30_000 })
            .toContain(`pid=${pid}`);
        await last.app.close();
    });
});

/** How many of This computer's sessions the app cached in `sessions.json` for the next launch (US-2.3.2). */
function cachedLocalSessions(trcHome: string): number {
    const file = join(trcHome, 'sessions.json');
    if (!existsSync(file)) {
        return 0;
    }
    const cache = JSON.parse(readFileSync(file, 'utf8')) as { readonly hosts?: Record<string, readonly unknown[]> };
    return cache.hosts?.['local']?.length ?? 0;
}

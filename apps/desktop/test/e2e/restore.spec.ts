import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Locator, test } from '@playwright/test';
import {
    launchWithTestHosts,
    openTerminal,
    removeInstall,
    rowTexts,
    scratchInstallRoot,
    testHostsMissing,
} from './support/test-host';

const missing = testHostsMissing();

async function screenText(terminal: Locator): Promise<string> {
    return (await rowTexts(terminal)).join('\n');
}

test.describe('restoring sessions at launch (US-2.1, US-2.3)', () => {
    const install = { root: '' };
    test.skip(missing !== undefined, missing);
    test.beforeEach(() => {
        install.root = scratchInstallRoot();
    });
    test.afterEach(() => {
        removeInstall('trc-ubuntu', install.root);
    });

    test('lists the last run’s sessions at launch and reattaches them with their output', async () => {
        const first = await launchWithTestHosts(install.root);
        const terminal = await openTerminal(first.window, 'trc-ubuntu');
        await expect.poll(() => screenText(terminal), { timeout: 30_000 }).toMatch(/[$#] *$/m);
        await terminal.focus();
        await first.window.keyboard.type('echo kept-across-launches');
        await first.window.keyboard.press('Enter');
        await expect.poll(() => rowTexts(terminal), { timeout: 15_000 }).toContain('kept-across-launches');
        const cacheFile = join(first.home, 'sessions.json');
        await expect
            .poll(() => existsSync(cacheFile) && readFileSync(cacheFile, 'utf8').includes('"state"'))
            .toBe(true);
        expect(statSync(cacheFile).mode & 0o777).toBe(0o600);
        expect(readFileSync(cacheFile, 'utf8')).not.toMatch(/"(cwd|env|pid|size)"/);
        await first.app.close();
        const second = await launchWithTestHosts(install.root, [], first.scratch);
        const session = second.window.getByRole('treeitem', { name: /, (Reconnecting|Running)$/ });
        await expect(session).toBeVisible({ timeout: 10_000 });
        await expect(second.window.getByRole('button', { name: 'Disconnect trc-ubuntu' })).toBeVisible({
            timeout: 60_000,
        });
        await second.window.getByRole('treeitem', { name: /, Running$/ }).click();
        const restored = second.window.getByRole('textbox', { name: /, trc-ubuntu$/ });
        await expect.poll(() => rowTexts(restored), { timeout: 30_000 }).toContain('kept-across-launches');
        await second.app.close();
    });
});

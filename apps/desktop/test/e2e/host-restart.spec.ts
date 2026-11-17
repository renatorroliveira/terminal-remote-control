import { expect, type Locator, type Page, test } from '@playwright/test';
import {
    launchWithTestHosts,
    onTestHost,
    openTerminal,
    recordSpeech,
    removeInstall,
    restartTestHost,
    rowTexts,
    scratchInstallRoot,
    spokenTexts,
    testHostsMissing,
} from './support/test-host';

/** Every Linux test host, as each runs its daemon on its own and restarts with every process ended. */
const HOSTS = ['trc-ubuntu', 'trc-alpine', 'trc-rocky'] as const;
const missing = testHostsMissing();

/** Types a command into the open terminal of `host` and waits until its output shows. */
async function run(window: Page, host: string, command: string, output: string): Promise<void> {
    const terminal = window.getByRole('textbox', { name: new RegExp(`, ${host}$`) });
    await expect
        .poll(() => rowTexts(terminal).then((rows) => rows.join('\n')), { timeout: 30_000 })
        .toMatch(/[$#] *$/m);
    await terminal.focus();
    await window.keyboard.type(command);
    await window.keyboard.press('Enter');
    await expect.poll(() => rowTexts(terminal), { timeout: 15_000 }).toContain(output);
}

/** Whether a row of the terminal, without its padding, matches `pattern`. */
async function hasRow(terminal: Locator, pattern: RegExp): Promise<boolean> {
    const rows = await rowTexts(terminal);
    return rows.some((row) => pattern.test(row.trim()));
}

for (const HOST of HOSTS) {
    test.describe(`sessions restored after ${HOST} restarts (US-3.1, P-42)`, () => {
        const install = { root: '' };
        test.skip(missing !== undefined, missing);
        test.beforeEach(() => {
            install.root = scratchInstallRoot();
        });
        test.afterEach(() => {
            removeInstall(HOST, install.root);
        });

        test('brings a session back below its saved scrollback, marked and announced until it is opened', async () => {
            test.setTimeout(240_000);
            const { app, window } = await launchWithTestHosts(install.root);
            await openTerminal(window, HOST);
            await run(window, HOST, 'echo before-restart-$((40+2))', 'before-restart-42');
            const saved = `grep -l before-restart-42 ${install.root.replace('~', '$HOME')}/sessions/*/scrollback.log 2>/dev/null`;
            await expect.poll(() => onTestHost(HOST, saved), { timeout: 15_000 }).toContain('scrollback.log');
            await window.getByRole('button', { name: `New session on ${HOST}` }).click();
            await expect(window.getByRole('treeitem', { name: /, Running$/ })).toHaveCount(2, { timeout: 30_000 });
            await recordSpeech(window);
            restartTestHost(HOST);
            const restored = window.getByRole('treeitem', { name: /, Running, restored(, new output)?$/ });
            await expect(restored).toBeVisible({ timeout: 120_000 });
            await expect
                .poll(() => spokenTexts(window), { timeout: 30_000 })
                .toContain(`${HOST}: 2 sessions restored.`);
            await restored.click();
            const terminal = window.getByRole('textbox', { name: new RegExp(`, ${HOST}$`) });
            await expect.poll(() => rowTexts(terminal), { timeout: 30_000 }).toContain('before-restart-42');
            const marker = /^Session restored on \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC\. Previous processes ended\.$/;
            await expect.poll(() => hasRow(terminal, marker)).toBe(true);
            await expect(window.getByRole('treeitem', { name: /, restored/ })).toHaveCount(0);
            await run(window, HOST, 'echo after-restart-$((40+2))', 'after-restart-42');
            await app.close();
        });
    });
}

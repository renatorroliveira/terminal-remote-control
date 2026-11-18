import { expect, type Locator, type Page, test } from '@playwright/test';
import {
    E2E_HOST,
    launchWithTestHosts,
    onTestHost,
    openTerminal,
    recordSpeech,
    removeInstall,
    rowTexts,
    scratchInstallRoot,
    spokenTexts,
    testHostsMissing,
} from './support/test-host';

const HOST = E2E_HOST;
const missing = testHostsMissing();

async function run(window: Page, terminal: Locator, command: string, output: string): Promise<void> {
    await expect
        .poll(() => rowTexts(terminal).then((rows) => rows.join('\n')), { timeout: 30_000 })
        .toMatch(/[$#%] *$/m);
    await terminal.focus();
    await window.keyboard.type(command);
    await window.keyboard.press('Enter');
    await expect.poll(() => rowTexts(terminal), { timeout: 15_000 }).toContain(output);
}

async function openDetails(window: Page): Promise<Locator> {
    const row = window.getByRole('list', { name: 'Known hosts' }).getByRole('button', { name: new RegExp(HOST) });
    await row.focus();
    await window.keyboard.press('Shift+F10');
    await window.getByRole('menuitem', { name: `Details of ${HOST}…` }).click();
    return window.getByRole('dialog', { name: `Details of ${HOST}` });
}

test.describe('managing a host’s daemon from the app (US-3.3.1 to US-3.3.3)', () => {
    const install = { root: '' };
    test.skip(missing !== undefined, missing);
    test.beforeEach(() => {
        install.root = scratchInstallRoot();
    });
    test.afterEach(() => {
        removeInstall(HOST, install.root);
    });

    test('restarts the daemon with the session still running, then removes everything it wrote', async () => {
        test.setTimeout(180_000);
        const { app, window } = await launchWithTestHosts(install.root);
        const terminal = await openTerminal(window, HOST);
        await run(window, terminal, 'echo before-$((40+2))', 'before-42');
        const details = await openDetails(window);
        await expect(details.getByRole('textbox', { name: 'Logs' })).toHaveValue(/\/logs$/);
        await recordSpeech(window);
        await details.getByRole('button', { name: 'Restart daemon' }).click();
        await expect.poll(() => spokenTexts(window), { timeout: 60_000 }).toContain(`Daemon restarted on ${HOST}.`);
        expect(await spokenTexts(window)).not.toContain(`Connection to ${HOST} lost.`);
        await run(window, terminal, 'echo after-$((40+2))', 'after-42');
        expect(await rowTexts(terminal)).toContain('before-42');

        await (await openDetails(window)).getByRole('button', { name: 'Remove daemon from host…' }).click();
        await window.getByRole('alertdialog').getByRole('button', { name: 'Remove daemon' }).click();
        await expect.poll(() => spokenTexts(window), { timeout: 60_000 }).toContain(`Daemon removed from ${HOST}.`);
        const root = install.root.replace('~', '$HOME');
        expect(onTestHost(HOST, `test -e "${root}" && echo present || echo gone`).trim().split('\n').at(-1)).toBe(
            'gone',
        );
        await expect(window.getByRole('button', { name: `Connect ${HOST}` })).toHaveAccessibleDescription(
            'Daemon removed',
        );
        await app.close();
    });
});

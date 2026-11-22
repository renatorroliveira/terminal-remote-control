import { expect, type Locator, test } from '@playwright/test';
import {
    addHost,
    launchWithTestHosts,
    removeInstall,
    rowTexts,
    scratchInstallRoot,
    testHostsMissing,
} from './support/test-host';

const missing = testHostsMissing();
const HOST = 'trc-systemd-kill';

async function screenText(terminal: Locator): Promise<string> {
    return (await rowTexts(terminal)).join('\n');
}

test.describe('a host that ends sessions at logout (US-2.4.4)', () => {
    const install = { root: '' };
    test.skip(missing !== undefined, missing);
    test.beforeEach(() => {
        install.root = scratchInstallRoot();
    });
    test.afterEach(() => {
        removeInstall(HOST, install.root);
    });

    test('says so in the host’s status, and warns before the first session there only', async () => {
        const { app, window } = await launchWithTestHosts(install.root);
        await addHost(window, HOST);
        await window.getByRole('button', { name: `Connect ${HOST}` }).click();
        const ending = 'programs end when its last connection closes';
        await expect(window.getByRole('treeitem', { name: new RegExp(`^${HOST}.*${ending}`) })).toBeVisible({
            timeout: 60_000,
        });
        const create = window.getByRole('button', { name: `New session on ${HOST}` });
        await create.click();
        const warning = window.getByRole('alertdialog', { name: `Programs on ${HOST} end when you disconnect` });
        await warning.getByRole('button', { name: 'Create Session' }).click();
        const terminal = window.getByRole('textbox', { name: new RegExp(`, ${HOST}$`) });
        await expect.poll(() => screenText(terminal), { timeout: 30_000 }).toMatch(/[$#%] *$/m);
        await create.click();
        await expect(window.getByRole('treeitem', { name: /, Running$/ })).toHaveCount(2, { timeout: 30_000 });
        await expect(warning).toHaveCount(0);
        await app.close();
    });
});

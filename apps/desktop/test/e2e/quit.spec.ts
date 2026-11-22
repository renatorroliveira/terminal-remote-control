import { expect, type Locator, test } from '@playwright/test';
import { ssh } from '../nfr/live-host';
import { forceKill } from '../test-platform';
import {
    E2E_HOST,
    launchWithTestHosts,
    openTerminal,
    removeInstall,
    rowTexts,
    scratchInstallRoot,
    type TestHostApp,
    testHostsMissing,
} from './support/test-host';

const missing = testHostsMissing();

async function screenText(terminal: Locator): Promise<string> {
    return (await rowTexts(terminal)).join('\n');
}

/** Opens a session on the e2e host and returns its shell's PID, which the shell prints. */
async function shellPid(launched: TestHostApp): Promise<string> {
    const terminal = await openTerminal(launched.window, E2E_HOST);
    await expect.poll(() => screenText(terminal), { timeout: 30_000 }).toMatch(/[$#%] *$/m);
    await terminal.focus();
    await launched.window.keyboard.type('echo "pid=$$"');
    await launched.window.keyboard.press('Enter');
    let pid = '';
    await expect
        .poll(async () => {
            pid = /^pid=(\d+)$/m.exec(await screenText(terminal))?.[1] ?? '';
            return pid;
        })
        .not.toBe('');
    return pid;
}

/** Chooses an item of the app's menus, as a click would. */
function chooseMenuItem(launched: TestHostApp, label: string): Promise<void> {
    return launched.app.evaluate(({ Menu }, wanted) => {
        const items = Menu.getApplicationMenu()?.items.flatMap((item) => item.submenu?.items ?? []) ?? [];
        items.find((item) => item.label === wanted)?.click();
    }, label);
}

function alive(pid: string): boolean {
    return ssh(E2E_HOST, `kill -0 ${pid} 2>/dev/null && echo alive || echo gone`).trim() === 'alive';
}

test.describe('quitting (US-2.1)', () => {
    const install = { root: '' };
    test.skip(missing !== undefined, missing);
    test.beforeEach(() => {
        install.root = scratchInstallRoot();
    });
    test.afterEach(() => {
        removeInstall(E2E_HOST, install.root);
    });

    test('says once that sessions keep running, and a quit, a crash and a force-kill end none', async () => {
        const first = await launchWithTestHosts(install.root, { firstQuit: true });
        const pid = await shellPid(first);
        void first.app.evaluate(({ app }) => app.quit());
        const notice = first.window.getByRole('alertdialog', { name: 'Your sessions keep running' });
        await expect(notice).toBeVisible();
        const closed = first.app.waitForEvent('close');
        await notice.getByRole('button', { name: 'Quit', exact: true }).click();
        await closed;
        expect(alive(pid)).toBe(true);
        const again = await launchWithTestHosts(install.root, { scratch: first.scratch, firstQuit: true });
        await again.window.getByRole('button', { name: `Disconnect ${E2E_HOST}` }).waitFor({ timeout: 60_000 });
        await again.app.close();
        expect(alive(pid)).toBe(true);
        const crashing = await launchWithTestHosts(install.root, { scratch: first.scratch });
        await crashing.window.getByRole('button', { name: `Disconnect ${E2E_HOST}` }).waitFor({ timeout: 60_000 });
        const crashed = crashing.app.waitForEvent('close');
        await crashing.app.evaluate(() => process.crash()).catch(() => undefined);
        await crashed;
        expect(alive(pid)).toBe(true);
        const killed = await launchWithTestHosts(install.root, { scratch: first.scratch });
        await killed.window.getByRole('button', { name: `Disconnect ${E2E_HOST}` }).waitFor({ timeout: 60_000 });
        const gone = killed.app.waitForEvent('close');
        forceKill(killed.app.process().pid ?? 0);
        await gone;
        expect(alive(pid)).toBe(true);
        const last = await launchWithTestHosts(install.root, { scratch: first.scratch });
        await last.window.getByRole('treeitem', { name: /, Running$/ }).click({ timeout: 60_000 });
        const terminal = last.window.getByRole('textbox', { name: new RegExp(`, ${E2E_HOST}$`) });
        await expect.poll(() => screenText(terminal), { timeout: 30_000 }).toContain(`pid=${pid}`);
        await last.app.close();
    });

    test('Quit and Stop All Sessions asks first, then stops every session and quits (US-2.1.4)', async () => {
        const launched = await launchWithTestHosts(install.root);
        const pid = await shellPid(launched);
        const stopAll = process.platform === 'darwin' ? 'Quit and Stop All Sessions…' : 'Exit and Stop All Sessions…';
        await chooseMenuItem(launched, stopAll);
        const confirm = launched.window.getByRole('alertdialog', { name: 'Stop all sessions and quit?' });
        await expect(confirm).toContainText('1 session on 1 host will stop');
        const closed = launched.app.waitForEvent('close');
        await confirm.getByRole('button', { name: 'Stop Sessions and Quit' }).click();
        await closed;
        await expect.poll(() => alive(pid), { timeout: 15_000 }).toBe(false);
    });
});

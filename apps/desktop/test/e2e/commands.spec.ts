import { existsSync } from 'node:fs';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { shortcutKeys } from '../test-platform';
import { launchApp, skipFirstQuitNotice } from './support/launch';
import { LOCAL_DAEMON, removeLocalDaemon, scratchLocal } from './support/local-host';
import {
    E2E_HOST,
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

async function prompted(terminal: Locator): Promise<void> {
    await expect.poll(async () => (await rowTexts(terminal)).join('\n'), { timeout: 30_000 }).toMatch(/[$#%>] *$/m);
}

async function run(window: Page, command: string): Promise<void> {
    await window.keyboard.type(command);
    await window.keyboard.press('Enter');
}

async function spokenWith(window: Page, part: string): Promise<readonly string[]> {
    return (await spokenTexts(window)).filter((text) => text.includes(part));
}

test.describe('commands in a live session (US-5.1, US-5.2, US-5.3, US-5.4)', () => {
    const install = { root: '' };
    test.skip(missing !== undefined, missing);
    test.beforeEach(() => {
        install.root = scratchInstallRoot();
    });
    test.afterEach(() => {
        removeInstall(E2E_HOST, install.root);
    });

    test('announces a failed command, moves between commands and reads the last output (US-5.2)', async () => {
        const { app, window } = await launchWithTestHosts(install.root, { args: ['--screen-reader-mode=on'] });
        await recordSpeech(window);
        const terminal = await openTerminal(window, E2E_HOST);
        await terminal.focus();
        await prompted(terminal);
        await run(window, 'echo trc-""first');
        await expect.poll(() => rowTexts(terminal), { timeout: 15_000 }).toContain('trc-first');
        await run(window, 'false');
        await expect
            .poll(() => spokenWith(window, 'Command failed, exit code 1.'), { timeout: 15_000 })
            .not.toEqual([]);
        await window.keyboard.press(shortcutKeys('command.previous'));
        await expect.poll(() => spokenWith(window, 'false. Failed, exit code 1.'), { timeout: 5_000 }).not.toEqual([]);
        await window.keyboard.press(shortcutKeys('command.previous'));
        await expect.poll(() => spokenWith(window, 'echo trc-""first'), { timeout: 5_000 }).not.toEqual([]);
        await run(window, 'printf "one\\ntwo\\n"');
        await expect.poll(() => rowTexts(terminal), { timeout: 15_000 }).toContain('two');
        await window.keyboard.press(shortcutKeys('command.readOutput'));
        await expect.poll(() => spokenWith(window, 'one\ntwo'), { timeout: 5_000 }).not.toEqual([]);
        await app.close();
    });

    test('announces and badges a bell in a background session, and Go to session goes back to it (US-5.3, US-5.4)', async () => {
        const { app, window } = await launchWithTestHosts(install.root, { args: ['--screen-reader-mode=on'] });
        await recordSpeech(window);
        const terminal = await openTerminal(window, E2E_HOST);
        await terminal.focus();
        await prompted(terminal);
        await run(window, "sleep 3; printf '\\a'");
        await window.keyboard.press(shortcutKeys('session.new'));
        const rows = window.getByRole('tree', { name: 'Sessions' }).getByRole('treeitem', { level: 2 });
        await expect(rows).toHaveCount(2, { timeout: 30_000 });
        await expect(rows.first()).toHaveAccessibleName(/, bell$/, { timeout: 15_000 });
        await expect.poll(() => spokenWith(window, ': bell.'), { timeout: 5_000 }).not.toEqual([]);
        await window.keyboard.press(shortcutKeys('session.quickSwitch'));
        const switcher = window.getByRole('dialog', { name: 'Go to session' });
        await expect(switcher.getByRole('status')).toHaveText('2 sessions.');
        await window.keyboard.press('ArrowDown');
        await window.keyboard.press('Enter');
        await expect(switcher).toHaveCount(0);
        await expect(rows.first()).toHaveAttribute('aria-selected', 'true');
        await expect(rows.first()).not.toHaveAccessibleName(/bell/);
        await app.close();
    });
});

test.describe('commands on This computer (US-5.1, US-5.2, P-71)', () => {
    test.skip(process.platform !== 'darwin' || !existsSync(LOCAL_DAEMON), 'needs macOS and pnpm build:daemon');
    const scratch = { trcHome: '' };
    test.afterEach(() => {
        removeLocalDaemon(scratch.trcHome);
    });

    test('marks the commands of the login shell, announces the one that fails, and moves to it', async () => {
        const local = scratchLocal();
        scratch.trcHome = local.trcHome;
        skipFirstQuitNotice(local.trcHome);
        const app = await launchApp(['--screen-reader-mode=on'], {
            TRC_HOME: local.trcHome,
            TRC_TEST_LOCAL_HOME: local.localHome,
        });
        const window = await app.firstWindow();
        await recordSpeech(window);
        await window.getByRole('button', { name: 'Disconnect This computer' }).waitFor({ timeout: 60_000 });
        await window.getByRole('button', { name: 'New session on This computer' }).click();
        const terminal = window.getByRole('textbox', { name: /, This computer$/ });
        await terminal.waitFor({ timeout: 30_000 });
        await terminal.focus();
        await prompted(terminal);
        await run(window, '(exit 3)');
        await expect
            .poll(() => spokenWith(window, 'Command failed, exit code 3.'), { timeout: 15_000 })
            .not.toEqual([]);
        await window.keyboard.press(shortcutKeys('command.previous'));
        await expect
            .poll(() => spokenWith(window, '(exit 3). Failed, exit code 3.'), { timeout: 5_000 })
            .not.toEqual([]);
        await app.close();
    });
});

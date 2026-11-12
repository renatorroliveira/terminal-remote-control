import { expect, type Locator, test } from '@playwright/test';
import { launchWithTestHosts, openTerminal, rowTexts, testHostsMissing } from './support/test-host';

const missing = testHostsMissing();

async function screenText(terminal: Locator): Promise<string> {
    return (await rowTexts(terminal)).join('\n');
}

test.describe('a live terminal on a Linux host (M1)', () => {
    test.skip(missing !== undefined, missing);

    test('types a command and reads its output as real text (US-1.11, A11Y-04.1, D-22)', async () => {
        const { app, window } = await launchWithTestHosts();
        const terminal = await openTerminal(window, 'trc-ubuntu');
        await terminal.focus();
        await expect.poll(() => screenText(terminal), { timeout: 30_000 }).toMatch(/[$#] *$/m);
        await window.keyboard.type('echo hi');
        await window.keyboard.press('Enter');
        await expect.poll(() => rowTexts(terminal), { timeout: 15_000 }).toContain('hi');
        await expect(terminal).toBeFocused();
        await expect(window.locator('.xterm')).toHaveAttribute('aria-hidden', 'true');
        await app.close();
    });
});

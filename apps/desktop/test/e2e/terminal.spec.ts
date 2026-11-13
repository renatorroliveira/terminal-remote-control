import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
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

async function screenText(terminal: Locator): Promise<string> {
    return (await rowTexts(terminal)).join('\n');
}

interface Point {
    readonly x: number;
    readonly y: number;
    readonly width: number;
}

async function wordCenter(window: Page, row: string, word: string): Promise<Point> {
    const point = await window.evaluate(
        ([text, target]) => {
            const node = [...document.querySelectorAll('[data-row]')].find(
                (element) => element.textContent === text,
            )?.firstChild;
            const start = node?.textContent?.indexOf(target) ?? -1;
            if (!(node instanceof Text) || start < 0) {
                return undefined;
            }
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, start + target.length);
            const box = range.getBoundingClientRect();
            return { x: box.left + box.width / 2, y: box.top + box.height / 2, width: box.width };
        },
        [row, word] as const,
    );
    if (point === undefined) {
        throw new Error(`no "${word}" in "${row}"`);
    }
    return point;
}

function recordCanvasFonts(): void {
    const property = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font');
    const fonts: string[] = [];
    (window as unknown as { canvasFonts: string[] }).canvasFonts = fonts;
    Object.defineProperty(CanvasRenderingContext2D.prototype, 'font', {
        configurable: true,
        get(this: CanvasRenderingContext2D) {
            return property?.get?.call(this);
        },
        set(this: CanvasRenderingContext2D, value: string) {
            const before = String(property?.get?.call(this));
            property?.set?.call(this, value);
            const after = String(property?.get?.call(this));
            fonts.push(after === before && value.trim() !== before ? `rejected:${value}` : after);
        },
    });
}

async function spokenWith(window: Page, part: string): Promise<string[]> {
    return (await spokenTexts(window)).filter((text) => text.includes(part));
}

function domSelection(window: Page): Promise<string> {
    return window.evaluate(() => getSelection()?.toString() ?? '');
}

/** Skips the block without test hosts, and gives each of its tests a scratch install that it removes afterwards. */
function liveHost(): { root: string } {
    const install = { root: '' };
    test.skip(missing !== undefined, missing);
    test.beforeEach(() => {
        install.root = scratchInstallRoot();
    });
    test.afterEach(() => {
        removeInstall('trc-ubuntu', install.root);
    });
    return install;
}

test.describe('a live terminal on a Linux host (M1)', () => {
    const install = liveHost();

    test('types a command and reads its output as real text (US-1.11, A11Y-04.1, D-22)', async () => {
        const { app, window } = await launchWithTestHosts(install.root);
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

test.describe('a live terminal on a Linux host: spoken output (A11Y-02, A11Y-10.2)', () => {
    const install = liveHost();

    test('speaks a command’s output in screen-reader mode, but not the echo of what was typed (A11Y-01.4)', async () => {
        const { app, window } = await launchWithTestHosts(install.root, ['--screen-reader-mode=on']);
        await recordSpeech(window);
        const terminal = await openTerminal(window, 'trc-ubuntu');
        await terminal.focus();
        await expect.poll(() => screenText(terminal), { timeout: 30_000 }).toMatch(/[$#] *$/m);
        await window.waitForTimeout(500);
        await window.keyboard.type('echo trc""spoken');
        await window.keyboard.press('Enter');
        await expect.poll(() => spokenWith(window, 'trcspoken'), { timeout: 15_000 }).not.toEqual([]);
        expect(await spokenWith(window, 'echo')).toEqual([]);
        await app.close();
    });
});

async function commandClick(terminal: Locator, point: Point): Promise<void> {
    const box = await terminal.boundingBox();
    if (box === null) {
        throw new Error('the terminal is not on the screen');
    }
    await terminal.click({ position: { x: point.x - box.x, y: point.y - box.y }, modifiers: ['Meta'] });
}

function readOrEmpty(file: string): string {
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

test.describe('a live terminal on a Linux host: links (US-1.12.3, US-1.12.4)', () => {
    const install = liveHost();

    test('confirms a Command+clicked link, trusts its origin when asked, then opens that origin’s links at once', async () => {
        const { app, window, home, openedLinks } = await launchWithTestHosts(install.root);
        const terminal = await openTerminal(window, 'trc-ubuntu');
        await terminal.focus();
        await expect.poll(() => screenText(terminal), { timeout: 30_000 }).toMatch(/[$#] *$/m);
        await window.keyboard.type(
            String.raw`printf '\e]8;;https://example.com/real\e\\the docs\e]8;;\e\\ or https://example.com/plain\n'`,
        );
        await window.keyboard.press('Enter');
        const row = 'the docs or https://example.com/plain';
        await expect.poll(() => rowTexts(terminal), { timeout: 15_000 }).toContain(row);
        await commandClick(terminal, await wordCenter(window, row, 'docs'));
        const dialog = window.getByRole('alertdialog', { name: 'Open this link?' });
        await expect(dialog.getByRole('textbox', { name: 'Address' })).toHaveValue('https://example.com/real');
        await dialog.getByRole('button', { name: 'Always open links that start with https://example.com' }).click();
        await expect.poll(() => readOrEmpty(openedLinks)).toBe('https://example.com/real\n');
        expect(JSON.parse(readFileSync(join(home, 'accept_urls.json'), 'utf8'))).toEqual(['https://example.com']);
        await commandClick(terminal, await wordCenter(window, row, 'plain'));
        await expect.poll(() => readOrEmpty(openedLinks)).toBe('https://example.com/real\nhttps://example.com/plain\n');
        await expect(dialog).toHaveCount(0);
        await app.close();
    });
});

test.describe('a live terminal on a Linux host: paste (US-1.12.2)', () => {
    const install = liveHost();

    test('asks before pasting two lines, and the shell runs them on Return after a bracketed paste', async () => {
        const { app, window } = await launchWithTestHosts(install.root);
        const terminal = await openTerminal(window, 'trc-ubuntu');
        await terminal.focus();
        await expect.poll(() => screenText(terminal), { timeout: 30_000 }).toMatch(/[$#] *$/m);
        await terminal.evaluate((surface) => {
            const data = new DataTransfer();
            data.setData('text/plain', 'echo pasted-one\necho pasted-two\n');
            surface.dispatchEvent(
                new InputEvent('beforeinput', {
                    bubbles: true,
                    cancelable: true,
                    inputType: 'insertFromPaste',
                    dataTransfer: data,
                }),
            );
        });
        const dialog = window.getByRole('alertdialog', { name: 'Paste 2 lines?' });
        await dialog.getByRole('button', { name: 'Paste' }).click();
        await expect(dialog).toHaveCount(0);
        await expect(terminal).toBeFocused();
        await expect.poll(() => rowTexts(terminal), { timeout: 15_000 }).toContain('echo pasted-two');
        expect(await rowTexts(terminal)).not.toContain('pasted-one');
        await window.keyboard.press('Enter');
        await expect.poll(() => rowTexts(terminal), { timeout: 15_000 }).toContain('pasted-two');
        expect(await rowTexts(terminal)).toContain('pasted-one');
        await app.close();
    });
});

test.describe('a live terminal on a Linux host: review mode and find (A11Y-03, US-1.13)', () => {
    const install = liveHost();

    test('reads the buffer in review mode, finds matches, and returns to the terminal each time', async () => {
        const { app, window } = await launchWithTestHosts(install.root);
        const terminal = await openTerminal(window, 'trc-ubuntu');
        await terminal.focus();
        await expect.poll(() => screenText(terminal), { timeout: 30_000 }).toMatch(/[$#] *$/m);
        const printed = ['needle-one', 'hay', 'needle-two'];
        const needles = printed.filter((line) => line.startsWith('needle-'));
        await window.keyboard.type(String.raw`printf 'ne%sle-one\nhay\nne%sle-two\n' ed ed`);
        await window.keyboard.press('Enter');
        await expect.poll(() => rowTexts(terminal), { timeout: 15_000 }).toContain('needle-two');
        await window.keyboard.press('Alt+F2');
        const review = window.getByRole('textbox', { name: /^Review / });
        await expect(review).toBeFocused();
        await expect(review).toHaveValue(new RegExp(printed.join('\n')));
        await window.keyboard.press('Escape');
        await expect(terminal).toBeFocused();
        await window.keyboard.press('Meta+F');
        const search = window.getByRole('searchbox', { name: 'Find' });
        await expect(search).toBeFocused();
        await search.fill('needle-');
        await expect(window.getByText(`${needles.length} of ${needles.length}`)).toBeVisible();
        await window.keyboard.press('Enter');
        await expect(window.getByText(`${needles.length - 1} of ${needles.length}`)).toBeVisible();
        await window.keyboard.press('Escape');
        await expect(terminal).toBeFocused();
        await app.close();
    });
});

test.describe('a live terminal on a Linux host: connection loss (US-1.14, US-1.5.5)', () => {
    const install = liveHost();

    test('shows the lost connection, refuses typing, and re-attaches the session after Connect', async () => {
        const { app, window, home } = await launchWithTestHosts(install.root);
        const terminal = await openTerminal(window, 'trc-ubuntu');
        await terminal.focus();
        await expect.poll(() => screenText(terminal), { timeout: 30_000 }).toMatch(/[$#] *$/m);
        await recordSpeech(window);
        execFileSync('pkill', ['-f', `${dirname(home)}/known_hosts`]);
        const lost = window.getByRole('textbox', { name: /, trc-ubuntu, disconnected$/ });
        await expect(lost).toBeVisible({ timeout: 30_000 });
        await expect(window.getByRole('treeitem', { name: /^bash.*, Disconnected$/ })).toBeVisible();
        await lost.focus();
        await window.keyboard.type('x');
        await expect(window.getByText('Disconnected — input not sent', { exact: true })).toBeVisible();
        await expect.poll(() => spokenWith(window, 'input not sent')).toHaveLength(1);
        await window.getByRole('button', { name: 'Connect trc-ubuntu' }).click();
        const restored = window.getByRole('textbox', { name: /, trc-ubuntu$/ });
        await expect(restored).toBeVisible({ timeout: 60_000 });
        await expect.poll(() => screenText(restored), { timeout: 30_000 }).toMatch(/[$#] *$/m);
        await restored.focus();
        await window.keyboard.type('echo back-again');
        await window.keyboard.press('Enter');
        await expect.poll(() => rowTexts(restored), { timeout: 15_000 }).toContain('back-again');
        await app.close();
    });
});

test.describe('a live terminal on a Linux host: leaving the terminal (A11Y-05)', () => {
    const install = liveHost();

    test('lets Tab leave the terminal in Tab focus mode, and passes an app shortcut on after send-next-key', async () => {
        const { app, window } = await launchWithTestHosts(install.root);
        const terminal = await openTerminal(window, 'trc-ubuntu');
        await terminal.focus();
        await expect.poll(() => screenText(terminal), { timeout: 30_000 }).toMatch(/[$#] *$/m);
        await window.keyboard.press('Shift+Meta+K');
        await window.keyboard.press('Meta+F6');
        await expect(terminal).toBeFocused();
        await window.keyboard.press('Shift+Meta+M');
        await expect(window.getByRole('button', { name: 'Tab moves focus' })).toHaveAttribute('aria-pressed', 'true');
        await window.keyboard.press('Tab');
        await expect(terminal).not.toBeFocused();
        await app.close();
    });
});

test.describe('a live session on a Linux host: rename and close (US-1.10)', () => {
    const install = liveHost();

    test('renames a session on the daemon, then closes it after the confirmation', async () => {
        const { app, window } = await launchWithTestHosts(install.root);
        await openTerminal(window, 'trc-ubuntu');
        const session = window.getByRole('treeitem', { name: /^bash/ }).first();
        await session.focus();
        await window.keyboard.press('Shift+F10');
        await window.getByRole('menuitem', { name: 'Rename…' }).click();
        await window.getByRole('textbox', { name: 'Name' }).fill('renamed-e2e');
        await window.keyboard.press('Enter');
        const renamed = window.getByRole('treeitem', { name: /^renamed-e2e, / });
        await expect(renamed).toBeVisible({ timeout: 15_000 });
        await renamed.focus();
        await window.keyboard.press('Shift+F10');
        await window.getByRole('menuitem', { name: 'Close…' }).click();
        await window.getByRole('button', { name: 'Close session' }).click();
        await expect(renamed).toHaveCount(0, { timeout: 15_000 });
        await app.close();
    });
});

test.describe('a live terminal on a Linux host: size and keys (M1)', () => {
    const install = liveHost();

    test('keeps the PTY the size of the grid as the window resizes (US-1.11.3)', async () => {
        const { app, window } = await launchWithTestHosts(install.root);
        const resize = (width: number, height: number) =>
            app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]?.setSize(size[0], size[1]), [
                width,
                height,
            ] as const);
        await resize(1000, 700);
        const terminal = await openTerminal(window, 'trc-ubuntu');
        await expect.poll(() => screenText(terminal), { timeout: 30_000 }).toMatch(/[$#] *$/m);
        const before = await terminal.getAttribute('data-columns');
        await resize(1500, 900);
        await expect.poll(() => terminal.getAttribute('data-columns')).not.toBe(before);
        await window.waitForTimeout(500);
        const grid = `${await terminal.getAttribute('data-rows')} ${await terminal.getAttribute('data-columns')}`;
        await terminal.pressSequentially('echo size=$(stty size)\n');
        await expect.poll(() => rowTexts(terminal), { timeout: 15_000 }).toContain(`size=${grid}`);
        await app.close();
    });

    test('delivers Shift+Enter as CSI 13;2u to a program that turned on kitty keys (US-1.11, D-30)', async () => {
        const { app, window } = await launchWithTestHosts(install.root);
        const terminal = await openTerminal(window, 'trc-ubuntu');
        await expect.poll(() => screenText(terminal), { timeout: 30_000 }).toMatch(/[$#] *$/m);
        await terminal.pressSequentially(
            "printf '\\033[>1u'; IFS= read -rs -d u key; printf '\\033[<u'; printf 'key=%q\\n' \"$key\"\n",
        );
        await window.waitForTimeout(500);
        await window.keyboard.press('Shift+Enter');
        await expect.poll(() => rowTexts(terminal), { timeout: 15_000 }).toContain("key=$'\\E[13;2'");
        await app.close();
    });
});

test.describe('a live terminal on a Linux host: selection and glyphs (M1)', () => {
    const install = liveHost();

    test('selects words and drags across text with the pointer while VoiceOver is on (A11Y-04.1, A11Y-04.3)', async () => {
        const { app, window } = await launchWithTestHosts(install.root);
        await app.evaluate(({ app: electronApp }) => electronApp.setAccessibilitySupportEnabled(true));
        const terminal = await openTerminal(window, 'trc-ubuntu');
        await terminal.focus();
        await expect.poll(() => screenText(terminal), { timeout: 30_000 }).toMatch(/[$#] *$/m);
        await window.keyboard.type('echo the quick brown fox');
        await window.keyboard.press('Enter');
        await expect.poll(() => rowTexts(terminal), { timeout: 15_000 }).toContain('the quick brown fox');
        const quick = await wordCenter(window, 'the quick brown fox', 'quick');
        await window.mouse.dblclick(quick.x, quick.y);
        await window.waitForTimeout(600);
        expect(await domSelection(window)).toBe('quick');
        const the = await wordCenter(window, 'the quick brown fox', 'the');
        const brown = await wordCenter(window, 'the quick brown fox', 'brown');
        await window.mouse.move(the.x - the.width / 2 + 1, the.y);
        await window.mouse.down();
        await window.mouse.move(brown.x, brown.y, { steps: 8 });
        await window.mouse.up();
        await window.waitForTimeout(600);
        expect(await domSelection(window)).toMatch(/^the quick br/);
        await app.close();
    });

    test('draws terminal glyphs in Intel One Mono, the font the canvas accepted (A11Y-07, US-1.11)', async () => {
        const { app, window } = await launchWithTestHosts(install.root);
        await app.context().addInitScript(recordCanvasFonts);
        await window.reload();
        const terminal = await openTerminal(window, 'trc-ubuntu');
        await expect.poll(() => screenText(terminal), { timeout: 30_000 }).toMatch(/[$#] *$/m);
        const fonts = await window.evaluate(() => (window as unknown as { canvasFonts?: string[] }).canvasFonts ?? []);
        expect(fonts.filter((font) => font.startsWith('rejected:'))).toEqual([]);
        expect(fonts.some((font) => font.includes('Intel One Mono'))).toBe(true);
        await app.close();
    });
});

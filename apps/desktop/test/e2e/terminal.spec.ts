import { expect, type Locator, type Page, test } from '@playwright/test';
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

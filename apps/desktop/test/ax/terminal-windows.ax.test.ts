import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Locator } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    launchWithTestHosts,
    openTerminal,
    removeInstall,
    scratchInstallRoot,
    type TestHostApp,
    testHostsMissing,
} from '../e2e/support/test-host';
import { electronMainPid, shortcutKeys } from '../test-platform';

const run = promisify(execFile);
const PROBE = resolve(import.meta.dirname, '../../../../tools/uia-probe/target/release/uia-probe.exe');

interface Rect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** A text range as the probe reports it: its text and its bounds on screen. */
interface RangeReport {
    readonly text: string;
    readonly rects: readonly Rect[];
}

interface FocusedReport {
    readonly controlType?: number;
    readonly localizedControlType?: string;
    readonly name?: string;
    readonly hasKeyboardFocus?: boolean;
    readonly textPattern?: boolean;
    readonly textPrefix?: string;
    readonly selection?: readonly RangeReport[];
    readonly caretRects?: readonly Rect[];
    readonly error?: string;
}

/**
 * The caret as a collapsed selection range, 1 pixel wide at the cursor: how UI Automation clients find it when the
 * element has no `TextPattern2`, as Chromium's text boxes have none (S9).
 */
function collapsedSelection(report: FocusedReport): RangeReport | undefined {
    const [only, ...others] = report.selection ?? [];
    return only !== undefined && others.length === 0 && only.text === '' ? only : undefined;
}

/** UI Automation's control type for an edit control, which Chromium gives a multi-line text box. */
const UIA_EDIT = 50_004;

async function probe(args: readonly string[]): Promise<Record<string, unknown>> {
    const stdout = await run(PROBE, [...args], { windowsHide: true }).then(
        (result) => result.stdout,
        (error: { readonly stdout: string }) => error.stdout,
    );
    return JSON.parse(stdout) as Record<string, unknown>;
}

/** A point of the page, in CSS pixels, in the screen pixels UI Automation uses, on the display the window is on. */
async function onScreen({ app }: TestHostApp, x: number, y: number): Promise<{ x: number; y: number; scale: number }> {
    const placement = await app.evaluate(({ BrowserWindow, screen }) => {
        const window = BrowserWindow.getAllWindows()[0];
        return window === undefined
            ? undefined
            : { content: window.getContentBounds(), scale: screen.getDisplayMatching(window.getBounds()).scaleFactor };
    });
    if (placement === undefined) {
        throw new Error('no window to place the point in');
    }
    const { content, scale } = placement;
    return { x: (content.x + x) * scale, y: (content.y + y) * scale, scale };
}

/** A terminal cell in the page's CSS pixels. */
async function cellInPage(window: TestHostApp['window'], row: number, column: number): Promise<Rect> {
    const cell = await window.evaluate(
        ([wantedRow, wantedColumn]) => {
            const screen = document.querySelector('.xterm-screen')?.getBoundingClientRect();
            const surface = document.querySelector<HTMLElement>('[role="textbox"][aria-multiline="true"]');
            const columns = Number(surface?.dataset['columns'] ?? 0);
            const rows = Number(surface?.dataset['rows'] ?? 0);
            if (screen === undefined || columns === 0 || rows === 0) {
                return undefined;
            }
            const width = screen.width / columns;
            const height = screen.height / rows;
            return {
                x: screen.left + (wantedColumn ?? 0) * width,
                y: screen.top + (wantedRow ?? 0) * height,
                width,
                height,
            };
        },
        [row, column],
    );
    if (cell === undefined) {
        throw new Error('no terminal cell to compare with');
    }
    return cell;
}

/** A terminal cell in screen pixels, which UI Automation reports. */
async function cellOnScreen(launched: TestHostApp, row: number, column: number): Promise<Rect> {
    const cell = await cellInPage(launched.window, row, column);
    const { x, y, scale } = await onScreen(launched, cell.x, cell.y);
    return { x, y, width: cell.width * scale, height: cell.height * scale };
}

/** The app in the foreground with a session on `trc-ubuntu` that printed `hi` on its first row, its terminal focused. */
async function launchWithHi(root: string): Promise<TestHostApp> {
    const launched = await launchWithTestHosts(root, { foreground: true });
    await launched.app.evaluate(({ app }) => app.setAccessibilitySupportEnabled(true));
    const terminal = await openTerminal(launched.window, 'trc-ubuntu');
    await terminal.focus();
    await launched.window.keyboard.type('clear; echo hi');
    await launched.window.keyboard.press('Enter');
    await terminal.locator('[data-row]', { hasText: /^hi$/ }).waitFor({ timeout: 15_000 });
    await terminal.locator('[data-row="1"]', { hasText: /[$#] $/ }).waitFor({ timeout: 15_000 });
    const raised = await probe(['foreground', String(electronMainPid(launched.app.process().pid ?? 0))]);
    if (raised['error'] !== undefined) {
        throw new Error(String(raised['error']));
    }
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());
    await terminal.focus();
    return launched;
}

const skip =
    process.platform !== 'win32'
        ? 'UI Automation is Windows only'
        : (testHostsMissing() ?? (existsSync(PROBE) ? undefined : 'build tools/uia-probe'));

describe.skipIf(skip !== undefined)('the terminal in Windows UI Automation (A11Y-01, A11Y-04, A11Y-06, S9)', () => {
    let launched: TestHostApp;
    const root = scratchInstallRoot();
    const pid = (): string => String(electronMainPid(launched.app.process().pid ?? 0));

    beforeAll(async () => {
        launched = await launchWithHi(root);
    }, 120_000);

    afterAll(async () => {
        await launched?.app.close();
        removeInstall('trc-ubuntu', root);
    });

    it('is the focused, named edit control holding the terminal text, with a text pattern', async () => {
        const report = (await probe(['focused', pid(), '5000'])) as FocusedReport;
        expect(report.error).toBeUndefined();
        expect(report.controlType).toBe(UIA_EDIT);
        expect(report.hasKeyboardFocus).toBe(true);
        expect(report.name?.endsWith(', trc-ubuntu'), report.name).toBe(true);
        expect(report.textPattern).toBe(true);
        expect(report.textPrefix?.split(/\r?\n/)[0]).toBe('hi');
    });

    it('reports a caret whose bounds cover the terminal cursor cell, for Magnifier (A11Y-06.2, A11Y-06.3)', async () => {
        const report = (await probe(['focused', pid(), '5000'])) as FocusedReport;
        const prompt = await launched.window.evaluate(
            () => document.querySelector('[role="textbox"] [data-row="1"]')?.textContent?.length ?? 0,
        );
        const cell = await cellOnScreen(launched, 1, prompt);
        const [caret] = report.caretRects ?? collapsedSelection(report)?.rects ?? [];
        expect(caret?.height ?? 0, JSON.stringify(report)).toBeGreaterThan(0);
        expect(Math.abs((caret?.x ?? 0) - cell.x)).toBeLessThan(cell.width / 2 + 1);
        expect(Math.abs((caret?.y ?? 0) - cell.y)).toBeLessThan(cell.height / 2 + 1);
    });

    it('reads the line under the pointer, as Magnifier read aloud does on Ctrl+Alt+click (A11Y-06.5)', async () => {
        const cell = await cellOnScreen(launched, 0, 0);
        const report = await probe([
            'at',
            String(Math.round(cell.x + cell.width / 2)),
            String(Math.round(cell.y + cell.height / 2)),
        ]);
        expect(report['error']).toBeUndefined();
        expect(String(report['line']).trim()).toBe('hi');
    });

    it('exposes a word chosen with the mouse as the text pattern selection (A11Y-04.1)', async () => {
        const cell = await cellInPage(launched.window, 0, 0);
        await launched.window.mouse.dblclick(cell.x + cell.width / 2, cell.y + cell.height / 2);
        const report = (await probe(['focused', pid(), '5000'])) as FocusedReport;
        expect(report.selection?.map((range) => range.text)).toEqual(['hi']);
        expect(report.selection?.[0]?.rects.length ?? 0).toBeGreaterThan(0);
    });

    it('gives review mode the same text, caret and line under the pointer (A11Y-03, A11Y-06.5)', async () => {
        await checkReviewMode(launched, pid());
    });
});

/** Whether `locator`'s element has focus in its page. */
function focused(locator: Locator): Promise<boolean> {
    return locator.evaluate((element) => element === document.activeElement);
}

/** Opens review mode on the `hi` session, checks what UI Automation reports for it, then closes it again. */
async function checkReviewMode(launched: TestHostApp, pid: string): Promise<void> {
    const { window } = launched;
    await window.keyboard.press(shortcutKeys('review.toggle'));
    const review = window.getByRole('textbox', { name: /^Review / });
    await expect.poll(() => focused(review)).toBe(true);
    const report = (await probe(['focused', pid, '5000'])) as FocusedReport;
    expect(report.controlType, JSON.stringify(report)).toBe(UIA_EDIT);
    expect(report.textPrefix?.split(/\r?\n/)[0]).toBe('hi');
    expect(collapsedSelection(report)?.rects.length ?? 0).toBeGreaterThan(0);
    const line = await review.evaluate((field) => {
        const box = field.getBoundingClientRect();
        return { x: box.left + 4, y: box.top + Number.parseFloat(getComputedStyle(field).lineHeight) / 2 };
    });
    const { x, y } = await onScreen(launched, line.x, line.y);
    const point = await probe(['at', String(Math.round(x)), String(Math.round(y))]);
    expect(String(point['line']).trim(), JSON.stringify(point)).toBe('hi');
    await window.keyboard.press('Escape');
}

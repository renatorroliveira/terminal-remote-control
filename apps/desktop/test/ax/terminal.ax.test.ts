import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    launchWithTestHosts,
    openTerminal,
    removeInstall,
    scratchInstallRoot,
    type TestHostApp,
    testHostsMissing,
} from '../e2e/support/test-host';

const run = promisify(execFile);
const PROBE = resolve(import.meta.dirname, '../../../../tools/ax-probe/.build/release/ax-probe');

interface Rect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

interface FocusedReport {
    readonly AXRole?: string;
    readonly AXTitle?: string;
    readonly AXDescription?: string;
    readonly AXFocused?: boolean;
    readonly AXValuePrefix?: string;
    readonly AXSelectedTextRange?: { readonly location: number; readonly length: number };
    readonly AXSelectedText?: string;
    readonly AXBoundsForTextMarkerRange?: Rect;
    readonly error?: string;
}

async function trusted(): Promise<boolean> {
    return run(PROBE, ['trusted']).then(
        () => true,
        () => false,
    );
}

async function focused(pid: number): Promise<FocusedReport> {
    const stdout = await run(PROBE, ['focused', String(pid), '3000']).then(
        (result) => result.stdout,
        (error: { readonly stdout: string }) => error.stdout,
    );
    return JSON.parse(stdout) as FocusedReport;
}

async function cursorCell({ app, window }: TestHostApp): Promise<Rect> {
    const content = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getContentBounds());
    const cell = await window.evaluate(() => {
        const screen = document.querySelector('.xterm-screen')?.getBoundingClientRect();
        const surface = document.querySelector<HTMLElement>('[role="textbox"][aria-multiline="true"]');
        const prompt = surface?.querySelector('[data-row="1"]')?.textContent ?? '';
        const columns = Number(surface?.dataset['columns'] ?? 0);
        const rows = Number(surface?.dataset['rows'] ?? 0);
        if (screen === undefined || columns === 0 || rows === 0) {
            return undefined;
        }
        const width = screen.width / columns;
        const height = screen.height / rows;
        return { x: screen.left + prompt.length * width, y: screen.top + height, width, height };
    });
    if (content === undefined || cell === undefined) {
        throw new Error('no terminal cell to compare with');
    }
    return { ...cell, x: content.x + cell.x, y: content.y + cell.y };
}

const skip = testHostsMissing() ?? ((await trusted()) ? undefined : 'grant the Accessibility permission');

describe.skipIf(skip !== undefined)('the terminal in the macOS accessibility tree (A11Y-01, A11Y-04, A11Y-06)', () => {
    let launched: TestHostApp;
    const root = scratchInstallRoot();

    beforeAll(async () => {
        launched = await launchWithTestHosts(root);
        await launched.app.evaluate(({ app }) => app.setAccessibilitySupportEnabled(true));
        const terminal = await openTerminal(launched.window, 'trc-ubuntu');
        await terminal.focus();
        await launched.window.keyboard.type('clear; echo hi');
        await launched.window.keyboard.press('Enter');
        await terminal.locator('[data-row]', { hasText: /^hi$/ }).waitFor({ timeout: 15_000 });
        await terminal.locator('[data-row="1"]', { hasText: /[$#] $/ }).waitFor({ timeout: 15_000 });
        await launched.app.evaluate(({ app, BrowserWindow }) => {
            app.focus({ steal: true });
            BrowserWindow.getAllWindows()[0]?.focus();
        });
    });

    afterAll(async () => {
        await launched?.app.close();
        removeInstall('trc-ubuntu', root);
    });

    it('is the focused, named text area holding the terminal text', async () => {
        const report = await focused(launched.app.process().pid ?? 0);
        expect(report.error).toBeUndefined();
        expect(report.AXRole).toBe('AXTextArea');
        expect(report.AXFocused).toBe(true);
        expect([report.AXTitle, report.AXDescription]).toContain('shell, trc-ubuntu');
        expect(report.AXValuePrefix?.split('\n')[0]).toBe('hi');
    });

    it('reports a collapsed caret whose bounds cover the terminal cursor cell, for Zoom (A11Y-06.3)', async () => {
        const report = await focused(launched.app.process().pid ?? 0);
        const cell = await cursorCell(launched);
        expect(report.AXSelectedTextRange?.length).toBe(0);
        const bounds = report.AXBoundsForTextMarkerRange;
        expect(bounds?.height).toBeGreaterThan(0);
        expect(Math.abs((bounds?.x ?? 0) - cell.x)).toBeLessThan(cell.width / 2);
        expect(Math.abs((bounds?.y ?? 0) - cell.y)).toBeLessThan(cell.height / 2);
    });
});

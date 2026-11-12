import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    launchWithTestHosts,
    openTerminal,
    rowTexts,
    type TestHostApp,
    testHostsMissing,
} from '../e2e/support/test-host';

const run = promisify(execFile);
const PROBE = resolve(import.meta.dirname, '../../../../tools/ax-probe/.build/release/ax-probe');

interface FocusedReport {
    readonly AXRole?: string;
    readonly AXTitle?: string;
    readonly AXDescription?: string;
    readonly AXFocused?: number;
    readonly AXValuePrefix?: string;
    readonly AXSelectedTextRange?: { readonly location: number; readonly length: number };
    readonly AXSelectedText?: string;
    readonly AXBoundsForTextMarkerRange?: { readonly width: number; readonly height: number };
    readonly error?: string;
}

async function trusted(): Promise<boolean> {
    return run(PROBE, ['trusted']).then(
        () => true,
        () => false,
    );
}

async function focused(pid: number): Promise<FocusedReport> {
    const { stdout } = await run(PROBE, ['focused', String(pid), '3000']);
    return JSON.parse(stdout) as FocusedReport;
}

const skip = testHostsMissing() ?? ((await trusted()) ? undefined : 'grant the Accessibility permission');

describe.skipIf(skip !== undefined)('the terminal in the macOS accessibility tree (A11Y-01, A11Y-04, A11Y-06)', () => {
    let launched: TestHostApp;

    beforeAll(async () => {
        launched = await launchWithTestHosts();
        const terminal = await openTerminal(launched.window, 'trc-ubuntu');
        await terminal.focus();
        await launched.window.keyboard.type('clear; echo hi');
        await launched.window.keyboard.press('Enter');
        await expect.poll(() => rowTexts(terminal), { timeout: 15_000 }).toContain('hi');
    });

    afterAll(async () => {
        await launched?.app.close();
    });

    it('is the focused, named text area holding the terminal text', async () => {
        const report = await focused(launched.app.process().pid ?? 0);
        expect(report.error).toBeUndefined();
        expect(report.AXRole).toBe('AXTextArea');
        expect(report.AXFocused).toBe(1);
        expect([report.AXTitle, report.AXDescription]).toContain('shell, trc-ubuntu');
        expect(report.AXValuePrefix?.split('\n')[0]).toBe('hi');
    });

    it('reports a collapsed caret with bounds at the terminal cursor', async () => {
        const report = await focused(launched.app.process().pid ?? 0);
        expect(report.AXSelectedTextRange?.length).toBe(0);
        expect(report.AXSelectedTextRange?.location).toBeGreaterThan(2);
        expect(report.AXBoundsForTextMarkerRange?.height).toBeGreaterThan(0);
    });
});

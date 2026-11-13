import axe from 'axe-core';
import { describe, expect, it, onTestFinished } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { connectedHost, installTokens, renderApp } from '../app-test-harness';

describe('AccessibilityHelp: Option+F1 (A11Y-10.1)', () => {
    it('lists the session list’s shortcuts and the general ones, and Escape returns focus', async () => {
        await page.viewport(1400, 800);
        onTestFinished(installTokens());
        const { client, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client);
        const row = screen.getByRole('treeitem', { name: /^bash/ }).first();
        await row.click();
        await userEvent.keyboard('{Alt>}{F1}{/Alt}');
        const dialog = screen.getByRole('dialog', { name: 'Accessibility help' });
        await expect.element(dialog).toBeVisible();
        await expect.element(dialog.getByRole('table', { name: 'In the session list' })).toBeVisible();
        await expect.element(dialog.getByRole('row', { name: 'Open the session Return' })).toBeVisible();
        await expect
            .element(
                dialog.getByRole('table', { name: 'Everywhere' }).getByRole('row', { name: /^Show command palette/ }),
            )
            .toBeVisible();
        await expect.element(dialog.getByRole('button', { name: 'User guide' })).toBeVisible();
        await expect.element(dialog.getByRole('button', { name: 'VoiceOver quick start' })).toBeVisible();
        const results = await axe.run(document.body, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] });
        expect(results.violations.map((violation) => violation.id)).toEqual([]);
        await userEvent.keyboard('{Escape}');
        await expect.element(dialog).not.toBeInTheDocument();
        await expect.element(row).toHaveFocus();
    });

    it('returns focus to the New host field it was opened from (A11Y-05)', async () => {
        await page.viewport(1400, 800);
        const { rendered } = renderApp();
        const screen = await rendered;
        const field = screen.getByRole('combobox', { name: 'New host' });
        await expect.element(field).toBeVisible();
        (field.element() as HTMLElement).focus();
        await userEvent.keyboard('{Alt>}{F1}{/Alt}');
        await expect.element(screen.getByRole('dialog', { name: 'Accessibility help' })).toBeVisible();
        await userEvent.keyboard('{Escape}');
        await expect.element(field).toHaveFocus();
    });

    it('opens the user guide, or its VoiceOver quick start, and closes (A11Y-10.4)', async () => {
        const { shell, guides, rendered } = renderApp();
        const screen = await rendered;
        shell.run('help.accessibility');
        await screen.getByRole('button', { name: 'VoiceOver quick start' }).click();
        await expect.element(screen.getByRole('dialog', { name: 'Accessibility help' })).not.toBeInTheDocument();
        shell.run('help.accessibility');
        await screen.getByRole('button', { name: 'User guide' }).click();
        shell.run('help.userGuide');
        expect(guides).toEqual(['voiceover', undefined, undefined]);
    });

    it('opens from the Help menu’s command too, for the context that had focus', async () => {
        const { shell, rendered } = renderApp();
        const screen = await rendered;
        shell.run('help.accessibility');
        await expect.element(screen.getByRole('table', { name: 'Everywhere' })).toBeVisible();
        await expect.element(screen.getByRole('table', { name: 'In the session list' })).not.toBeInTheDocument();
    });
});

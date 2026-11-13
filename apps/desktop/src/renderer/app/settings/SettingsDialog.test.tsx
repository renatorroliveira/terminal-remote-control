import axe from 'axe-core';
import { describe, expect, it, onTestFinished } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { connectedHost, installTokens, renderApp } from '../app-test-harness';
import { SETTING_ENTRIES } from './settings-catalog';

describe('SettingsDialog: one searchable settings page (A11Y-10.3)', () => {
    it('opens with Command+, in sections, passes axe, and Escape returns focus', async () => {
        await page.viewport(1400, 900);
        onTestFinished(installTokens());
        const { rendered } = renderApp();
        const screen = await rendered;
        const field = screen.getByRole('combobox', { name: 'New host' });
        (field.element() as HTMLElement).focus();
        await userEvent.keyboard('{Meta>},{/Meta}');
        const dialog = screen.getByRole('dialog', { name: 'Settings' });
        await expect.element(dialog.getByRole('searchbox', { name: 'Search settings' })).toHaveFocus();
        for (const section of [
            'Speech and announcements',
            'Sound',
            'Terminal display',
            'Keyboard',
            'Sessions',
            'Hosts',
        ]) {
            await expect.element(dialog.getByRole('heading', { level: 3, name: section })).toBeVisible();
        }
        const results = await axe.run(document.body, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] });
        expect(results.violations.map((violation) => violation.id)).toEqual([]);
        await userEvent.keyboard('{Escape}');
        await expect.element(dialog).not.toBeInTheDocument();
        await expect.element(field).toHaveFocus();
    });

    it('filters the settings as the user types, and says how many are shown', async () => {
        const { shell, rendered } = renderApp();
        const screen = await rendered;
        shell.run('settings.show');
        const total = SETTING_ENTRIES.filter((entry) => entry.id !== 'screenReaderMode').length;
        await expect.element(screen.getByText(`${total} of ${total} settings shown.`)).toBeVisible();
        await screen.getByRole('searchbox', { name: 'Search settings' }).fill('scrollback');
        await expect.element(screen.getByText(`1 of ${total} settings shown.`)).toBeVisible();
        await expect.element(screen.getByRole('textbox', { name: 'Scrollback lines' })).toBeVisible();
        await expect.element(screen.getByRole('switch', { name: 'Blinking cursor' })).not.toBeInTheDocument();
        await screen.getByRole('searchbox', { name: 'Search settings' }).fill('zzz');
        await expect.element(screen.getByText('No setting matches.')).toBeVisible();
    });
});

describe('SettingsDialog: changes (A11Y-10.3)', () => {
    it('keeps each change: numbers, switches and choices', async () => {
        const { shell, settingsSource, rendered } = renderApp();
        const screen = await rendered;
        shell.run('settings.show');
        const dialog = screen.getByRole('dialog', { name: 'Settings' });
        const flood = dialog.getByRole('textbox', { name: 'Lines a second before output is summarized' });
        await flood.fill('40');
        await userEvent.keyboard('{Tab}');
        await dialog.getByText('Ask before pasting more than one line').click();
        await dialog.getByText('Brief', { exact: true }).click();
        await dialog.getByText('Bar', { exact: true }).click();
        await expect
            .poll(() => settingsSource.changes)
            .toEqual([
                { floodThreshold: 40 },
                { pasteConfirmation: false },
                { verbosity: 'brief' },
                { terminalAppearance: { ...settingsSource.stored.terminalAppearance, cursorStyle: 'bar' } },
            ]);
        expect(shell.settings?.current.terminalAppearance.cursorStyle).toBe('bar');
    });
});

describe('SettingsDialog: shortcuts (A11Y-05.7)', () => {
    it('records a new shortcut, refuses one that breaks a rule, and resets it (A11Y-05.7)', async () => {
        const { shell, settingsSource, rendered } = renderApp();
        const screen = await rendered;
        shell.run('settings.show');
        const dialog = screen.getByRole('dialog', { name: 'Settings' });
        await dialog.getByRole('button', { name: 'Change Find…' }).click();
        await expect.element(dialog.getByRole('button', { name: /^Press the new shortcut for Find…/ })).toHaveFocus();
        await userEvent.keyboard('{Control>}c{/Control}');
        await expect.element(dialog.getByText('The terminal uses Control with that key.')).toBeVisible();
        await userEvent.keyboard('{F7}');
        await expect.element(dialog.getByText('Find…: F7.')).toBeVisible();
        await expect.element(dialog.getByRole('row', { name: /^Find… F7/ })).toBeVisible();
        expect(settingsSource.changes.at(-1)).toEqual({ shortcuts: { 'terminal.find': 'F7' } });
        expect(shell.keymap.commandFor({ ctrl: false, option: false, shift: false, cmd: false, key: 'F7' })).toBe(
            'terminal.find',
        );
        await dialog.getByRole('button', { name: 'Reset Find…' }).click();
        expect(settingsSource.changes.at(-1)).toEqual({ shortcuts: {} });
        await expect.element(dialog.getByText('Find…: back to Cmd+F.')).toBeVisible();
    });

    it('cancels recording with Escape without closing the page', async () => {
        const { shell, rendered } = renderApp();
        const screen = await rendered;
        shell.run('settings.show');
        const dialog = screen.getByRole('dialog', { name: 'Settings' });
        await dialog.getByRole('button', { name: 'Change Find…' }).click();
        await userEvent.keyboard('{Escape}');
        await expect.element(dialog).toBeVisible();
        await expect.element(dialog.getByRole('button', { name: 'Change Find…' })).toHaveFocus();
    });

    it('lets each host’s programs write the clipboard (SEC-06.1)', async () => {
        const { client, workspace, shell, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client);
        shell.run('settings.show');
        const dialog = screen.getByRole('dialog', { name: 'Settings' });
        const allow = dialog.getByRole('switch', { name: 'devbox-1' });
        await expect.element(allow).not.toBeChecked();
        await dialog.getByText('devbox-1', { exact: true }).click();
        await expect.poll(() => workspace.store.getState().hosts[0]?.allowClipboardWrites).toBe(true);
        await expect.element(allow).toBeChecked();
    });
});

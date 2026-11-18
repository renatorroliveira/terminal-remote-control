import axe from 'axe-core';
import { describe, expect, it, onTestFinished } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { type AppScreen, connectedHost, installTokens, renderApp } from '../app-test-harness';
import { SETTING_ENTRIES } from './settings-catalog';

const SECTIONS = ['Appearance', 'Speech and announcements', 'Sound', 'Keyboard', 'Sessions', 'Hosts'];

function settingsView(screen: AppScreen) {
    return screen.getByRole('main').getByRole('region', { name: 'Settings' });
}

async function openSection(screen: AppScreen, name: string) {
    await settingsView(screen)
        .getByRole('navigation', { name: 'Settings sections' })
        .getByRole('button', { name })
        .click();
    await expect.element(settingsView(screen).getByRole('heading', { level: 3, name })).toBeVisible();
}

describe('SettingsView: the settings in the content area (A11Y-10.3, US-1.6.7, P-72)', () => {
    it('opens from the sidebar link in place of the terminal, in sections, and passes axe', async () => {
        await page.viewport(1600, 900);
        onTestFinished(installTokens());
        const { rendered } = renderApp();
        const screen = await rendered;
        const link = screen
            .getByRole('navigation', { name: 'Sessions and hosts' })
            .getByRole('button', { name: 'Settings' });
        await link.click();
        const view = settingsView(screen);
        await expect.element(view.getByRole('searchbox', { name: 'Search settings' })).toHaveFocus();
        await expect.element(link).toHaveAttribute('aria-current', 'page');
        const sections = view
            .getByRole('navigation', { name: 'Settings sections' })
            .getByRole('list')
            .getByRole('button');
        expect(sections.elements().map((section) => section.textContent)).toEqual(SECTIONS);
        await expect.element(view.getByRole('heading', { level: 3, name: 'Appearance' })).toBeVisible();
        await expect.element(view.getByRole('radio', { name: 'High contrast dark' })).toBeVisible();
        await expect.element(view.getByRole('button', { name: 'Appearance' })).toHaveAttribute('aria-current', 'true');
        const results = await axe.run(document.body, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] });
        expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });

    it('is at most 1280 px wide and centered, with a 400 px list of sections', async () => {
        await page.viewport(2000, 900);
        const { shell, rendered } = renderApp();
        const screen = await rendered;
        shell.run('settings.show');
        await expect.element(settingsView(screen)).toBeVisible();
        const main = screen.getByRole('main').element().getBoundingClientRect();
        const frame = settingsView(screen).element().firstElementChild?.getBoundingClientRect();
        const nav = settingsView(screen).getByRole('navigation', { name: 'Settings sections' }).element();
        expect(frame?.width).toBeCloseTo(1280, 0);
        expect(Math.abs((frame?.left ?? 0) - main.left - (main.right - (frame?.right ?? 0)))).toBeLessThan(2);
        expect(nav.getBoundingClientRect().width).toBeCloseTo(400, 0);
    });

    it('stacks the sections above the settings at 320 CSS px, with no sideways scrolling (A11Y-07.5)', async () => {
        await page.viewport(320, 640);
        const { shell, rendered } = renderApp();
        const screen = await rendered;
        shell.run('settings.show');
        await expect.element(settingsView(screen)).toBeVisible();
        const view = settingsView(screen).element();
        const nav = settingsView(screen).getByRole('navigation', { name: 'Settings sections' }).element();
        const heading = settingsView(screen).getByRole('heading', { level: 3, name: 'Appearance' }).element();
        expect(heading.getBoundingClientRect().top).toBeGreaterThan(nav.getBoundingClientRect().bottom);
        expect(view.scrollWidth).toBeLessThanOrEqual(view.clientWidth);
    });

    it('opens the same way from Command+, and the palette, and Escape returns focus where it was', async () => {
        await page.viewport(1400, 900);
        const { rendered } = renderApp();
        const screen = await rendered;
        const field = screen.getByRole('combobox', { name: 'New host' });
        (field.element() as HTMLElement).focus();
        await userEvent.keyboard('{Meta>},{/Meta}');
        await expect.element(settingsView(screen).getByRole('searchbox', { name: 'Search settings' })).toHaveFocus();
        await userEvent.keyboard('{Escape}');
        await expect.element(settingsView(screen)).not.toBeInTheDocument();
        await expect.element(field).toHaveFocus();
        await userEvent.keyboard('{Shift>}{Meta>}p{/Meta}{/Shift}');
        await screen.getByRole('searchbox', { name: 'Command' }).fill('Settings');
        await userEvent.keyboard('{Enter}');
        await expect.element(settingsView(screen)).toBeVisible();
    });

    it('clears a search with Escape first, and goes back with the next Escape', async () => {
        const { shell, rendered } = renderApp();
        const screen = await rendered;
        shell.run('settings.show');
        const search = screen.getByRole('searchbox', { name: 'Search settings' });
        await search.fill('theme');
        await userEvent.keyboard('{Escape}');
        await expect.element(search).toHaveValue('');
        await expect.element(settingsView(screen)).toBeVisible();
        await userEvent.keyboard('{Escape}');
        await expect.element(settingsView(screen)).not.toBeInTheDocument();
    });

    it('goes back to the terminal when a session opens, and keeps the terminal’s size meanwhile', async () => {
        await page.viewport(1400, 900);
        const { client, terminals, shell, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client);
        shell.run('settings.show');
        await expect.element(settingsView(screen)).toBeVisible();
        const area = screen.getByRole('main').element().querySelector('[data-terminal-area]');
        expect(area?.getBoundingClientRect().width).toBeGreaterThan(0);
        expect(area?.hasAttribute('inert')).toBe(true);
        await screen.getByRole('treeitem', { name: 'bash, Running' }).click();
        await expect.element(settingsView(screen)).not.toBeInTheDocument();
        expect(terminals.shown.at(-1)).toBe('host-0/a');
        expect(area?.hasAttribute('inert')).toBe(false);
    });

    it('filters every section as the user types, and says how many are shown', async () => {
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

    it('shows a section when its button is chosen, and marks it current', async () => {
        const { shell, rendered } = renderApp();
        const screen = await rendered;
        shell.run('settings.show');
        await openSection(screen, 'Sessions');
        await expect.element(screen.getByRole('textbox', { name: 'Scrollback lines' })).toBeVisible();
        await expect.element(screen.getByRole('radio', { name: 'High contrast dark' })).not.toBeInTheDocument();
        await expect
            .element(settingsView(screen).getByRole('button', { name: 'Sessions' }))
            .toHaveAttribute('aria-current', 'true');
    });
});

describe('SettingsView: changes (A11Y-10.3)', () => {
    it('keeps each change: numbers, switches and choices', async () => {
        const { shell, settingsSource, rendered } = renderApp();
        const screen = await rendered;
        shell.run('settings.show');
        await openSection(screen, 'Speech and announcements');
        const view = settingsView(screen);
        const flood = view.getByRole('textbox', { name: 'Lines a second before output is summarized' });
        await flood.fill('40');
        await userEvent.keyboard('{Tab}');
        await view.getByText('Brief', { exact: true }).click();
        await openSection(screen, 'Sessions');
        await view.getByText('Ask before pasting more than one line').click();
        await openSection(screen, 'Appearance');
        await view.getByText('Bar', { exact: true }).click();
        await expect
            .poll(() => settingsSource.changes)
            .toEqual([
                { floodThreshold: 40 },
                { verbosity: 'brief' },
                { pasteConfirmation: false },
                { terminalAppearance: { ...settingsSource.stored.terminalAppearance, cursorStyle: 'bar' } },
            ]);
        expect(shell.settings?.current.terminalAppearance.cursorStyle).toBe('bar');
    });
});

describe('SettingsView: shortcuts (A11Y-05.7)', () => {
    it('records a new shortcut, refuses one that breaks a rule, and resets it (A11Y-05.7)', async () => {
        const { shell, settingsSource, rendered } = renderApp();
        const screen = await rendered;
        shell.run('settings.show');
        await openSection(screen, 'Keyboard');
        const view = settingsView(screen);
        await view.getByRole('button', { name: 'Change Find…' }).click();
        await expect.element(view.getByRole('button', { name: /^Press the new shortcut for Find…/ })).toHaveFocus();
        await userEvent.keyboard('{Control>}c{/Control}');
        await expect.element(view.getByText('The terminal uses Control with that key.')).toBeVisible();
        await userEvent.keyboard('{F7}');
        await expect.element(view.getByText('Find…: F7.')).toBeVisible();
        await expect.element(view.getByRole('row', { name: /^Find… F7/ })).toBeVisible();
        expect(settingsSource.changes.at(-1)).toEqual({ shortcuts: { 'terminal.find': 'F7' } });
        expect(shell.keymap.commandFor({ ctrl: false, option: false, shift: false, cmd: false, key: 'F7' })).toBe(
            'terminal.find',
        );
        await view.getByRole('button', { name: 'Reset Find…' }).click();
        expect(settingsSource.changes.at(-1)).toEqual({ shortcuts: {} });
        await expect.element(view.getByText('Find…: back to Cmd+F.')).toBeVisible();
    });

    it('cancels recording with Escape without closing the page', async () => {
        const { shell, rendered } = renderApp();
        const screen = await rendered;
        shell.run('settings.show');
        await openSection(screen, 'Keyboard');
        const view = settingsView(screen);
        await view.getByRole('button', { name: 'Change Find…' }).click();
        await userEvent.keyboard('{Escape}');
        await expect.element(view).toBeVisible();
        await expect.element(view.getByRole('button', { name: 'Change Find…' })).toHaveFocus();
    });

    it('lets each host’s programs write the clipboard (SEC-06.1)', async () => {
        const { client, workspace, shell, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client);
        shell.run('settings.show');
        await openSection(screen, 'Hosts');
        const view = settingsView(screen);
        const allow = view.getByRole('switch', { name: 'devbox-1' });
        await expect.element(allow).not.toBeChecked();
        await view.getByText('devbox-1', { exact: true }).click();
        await expect.poll(() => workspace.store.getState().hosts[0]?.allowClipboardWrites).toBe(true);
        await expect.element(allow).toBeChecked();
    });
});

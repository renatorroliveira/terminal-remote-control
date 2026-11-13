import axe from 'axe-core';
import { createIntl } from 'react-intl';
import { describe, expect, it, onTestFinished } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { resolveKeymap } from '../../shared/keymap';
import type { LinkCheck } from '../../shared/links';
import { messagesFor } from '../i18n/locale';
import { WorkspaceController } from '../sessions/workspace-controller';
import { FakeKnownHostStore, FakeTerminalHost, FakeWorkspaceClient } from '../sessions/workspace-test-doubles';
import { themeStyleSheet } from '../ui/themes';
import { AppProviders } from './AppProviders';
import { LinkDialogs } from './LinkDialogs';
import { NotificationCenter } from './notifications';
import { PasteDialog } from './PasteDialog';
import { type LinkControls, Shell } from './shell';

class RecordingLinks implements LinkControls {
    readonly opened: { readonly target: string; readonly trustOrigin: boolean }[] = [];

    async check(target: string): Promise<LinkCheck> {
        const origin = /^[a-z]+:\/\/[^/]+/.exec(target)?.[0];
        return { target, origin, trusted: false };
    }

    async open(target: string, trustOrigin: boolean): Promise<void> {
        this.opened.push({ target, trustOrigin });
    }
}

async function renderDialogs() {
    const tokens = document.createElement('style');
    tokens.textContent = themeStyleSheet();
    document.head.append(tokens);
    document.documentElement.dataset['theme'] = 'midnight';
    onTestFinished(() => {
        tokens.remove();
        delete document.documentElement.dataset['theme'];
    });
    const terminals = new FakeTerminalHost();
    const workspace = new WorkspaceController(new FakeWorkspaceClient([]), terminals, new FakeKnownHostStore());
    const links = new RecordingLinks();
    const shell = new Shell({
        workspace,
        terminals,
        sidebar: {
            width: () => Promise.resolve(400),
            setWidth: () => Promise.resolve(),
            collapsed: () => Promise.resolve(false),
            setCollapsed: () => Promise.resolve(),
        },
        announcer: { announce: () => undefined },
        notifications: new NotificationCenter(() => 0),
        keymap: resolveKeymap({}),
        intl: createIntl({ locale: 'en', messages: messagesFor('en') }),
        document,
        isNarrow: () => false,
        links,
    });
    const screen = await render(
        <AppProviders locale="en">
            <LinkDialogs shell={shell} />
            <PasteDialog shell={shell} />
        </AppProviders>,
    );
    return { screen, shell, links, terminals };
}

async function violations(): Promise<readonly unknown[]> {
    const results = await axe.run(document.body, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    });
    return results.violations;
}

describe('LinkDialogs: the link confirmation (US-1.12.4, SEC-06.2)', () => {
    it('shows the full address, says when the text hides it, and opens only when asked', async () => {
        const { screen, shell, links } = await renderDialogs();
        await shell.openLink({ text: 'the docs', target: 'https://example.com/real' });
        const dialog = screen.getByRole('alertdialog', { name: 'Open this link?' });
        await expect.element(dialog).toBeVisible();
        await expect.element(dialog.getByRole('textbox', { name: 'Address' })).toHaveValue('https://example.com/real');
        await expect.element(dialog.getByRole('textbox', { name: 'Address' })).toHaveFocus();
        await expect.element(dialog).toHaveAccessibleDescription(/shows “the docs”, but it opens the address below/);
        expect(await violations()).toEqual([]);
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect.element(dialog).not.toBeInTheDocument();
        expect(links.opened).toEqual([]);
    });

    it('opens the link, or trusts its origin and opens it', async () => {
        const { screen, shell, links } = await renderDialogs();
        await shell.openLink({ text: 'https://example.com/a', target: 'https://example.com/a' });
        await screen.getByRole('button', { name: 'Open', exact: true }).click();
        await shell.openLink({ text: 'https://example.com/b', target: 'https://example.com/b' });
        await screen.getByRole('button', { name: 'Always open links that start with https://example.com' }).click();
        await expect
            .poll(() => links.opened)
            .toEqual([
                { target: 'https://example.com/a', trustOrigin: false },
                { target: 'https://example.com/b', trustOrigin: true },
            ]);
    });

    it('offers no trust for a link without a host', async () => {
        const { screen, shell } = await renderDialogs();
        await shell.openLink({ text: 'mailto:dev@example.com', target: 'mailto:dev@example.com' });
        await expect.element(screen.getByRole('button', { name: 'Open', exact: true })).toBeVisible();
        await expect.element(screen.getByRole('button', { name: /Always open/ })).not.toBeInTheDocument();
    });
});

describe('LinkDialogs: List links (US-1.12.3)', () => {
    it('lists the links on the screen and opens the one chosen through the confirmation', async () => {
        const { screen, shell, terminals, links } = await renderDialogs();
        terminals.links = [
            { text: 'a.txt', target: 'file:///tmp/a.txt' },
            { text: 'https://example.com', target: 'https://example.com' },
        ];
        shell.run('terminal.listLinks');
        const dialog = screen.getByRole('dialog', { name: 'Links on the screen' });
        const list = dialog.getByRole('listbox', { name: 'Links' });
        await expect.element(list.getByRole('option', { name: 'a.txt file:///tmp/a.txt' })).toBeVisible();
        expect(await violations()).toEqual([]);
        await list.getByRole('option', { name: 'https://example.com' }).click();
        await expect.element(screen.getByRole('alertdialog', { name: 'Open this link?' })).toBeVisible();
        await userEvent.keyboard('{Escape}');
        await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument();
        expect(links.opened).toEqual([]);
    });
});

describe('PasteDialog: a paste of several lines asks first (US-1.12.2)', () => {
    it('states the line count, shows the text, and pastes only when asked', async () => {
        const { screen, shell, terminals } = await renderDialogs();
        shell.requestPaste('host-0/a', 'make\nmake install\n');
        const dialog = screen.getByRole('alertdialog', { name: 'Paste 2 lines?' });
        await expect.element(dialog.getByRole('textbox', { name: 'Text to paste' })).toHaveFocus();
        await expect
            .element(dialog.getByRole('textbox', { name: 'Text to paste' }))
            .toHaveValue('make\nmake install\n');
        expect(await violations()).toEqual([]);
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        expect(terminals.pasted).toEqual([]);
        shell.requestPaste('host-0/a', 'a\nb');
        await screen.getByRole('button', { name: 'Paste', exact: true }).click();
        expect(terminals.pasted).toEqual([['host-0/a', 'a\nb']]);
    });
});

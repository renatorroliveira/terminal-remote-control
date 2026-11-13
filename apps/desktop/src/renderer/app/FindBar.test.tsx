import axe from 'axe-core';
import { createIntl } from 'react-intl';
import { describe, expect, it, onTestFinished } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { resolveKeymap } from '../../shared/keymap';
import { messagesFor } from '../i18n/locale';
import { WorkspaceController } from '../sessions/workspace-controller';
import {
    bashSession,
    FakeKnownHostStore,
    FakeTerminalHost,
    FakeWorkspaceClient,
} from '../sessions/workspace-test-doubles';
import { themeStyleSheet } from '../ui/themes';
import { AppProviders } from './AppProviders';
import { FindBar } from './FindBar';
import { NotificationCenter } from './notifications';
import { Shell } from './shell';

const CONNECTED = { status: 'connected', daemon: { version: '0.2.0', sha256: 'ab', proto: 1 } } as const;

async function renderFind() {
    const tokens = document.createElement('style');
    tokens.textContent = themeStyleSheet();
    document.head.append(tokens);
    document.documentElement.dataset['theme'] = 'midnight';
    onTestFinished(() => {
        tokens.remove();
        delete document.documentElement.dataset['theme'];
    });
    const client = new FakeWorkspaceClient([bashSession('a')]);
    const terminals = new FakeTerminalHost();
    const workspace = new WorkspaceController(client, terminals, new FakeKnownHostStore());
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
    });
    await workspace.addHost('devbox-1');
    client.push('host-0', CONNECTED);
    await expect.poll(() => workspace.store.getState().sessions.get('host-0')?.length).toBe(1);
    workspace.open('host-0/a');
    const screen = await render(
        <AppProviders locale="en">
            <FindBar shell={shell} />
        </AppProviders>,
    );
    return { screen, shell, terminals };
}

describe('FindBar: find in the terminal (US-1.13, A11Y-03.6)', () => {
    it('searches as the user types, shows the match count, steps with Return, and closes on Escape', async () => {
        const { screen, shell, terminals } = await renderFind();
        terminals.matches = 17;
        shell.openFind();
        const search = screen.getByRole('searchbox', { name: 'Find' });
        await expect.element(search).toHaveFocus();
        await userEvent.type(search, 'error');
        await expect.element(screen.getByText('17 of 17')).toBeVisible();
        await userEvent.keyboard('{Enter}');
        await expect.element(screen.getByText('16 of 17')).toBeVisible();
        await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
        await expect.element(screen.getByText('17 of 17')).toBeVisible();
        const results = await axe.run(document.body, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
        });
        expect(results.violations).toEqual([]);
        await userEvent.keyboard('{Escape}');
        await expect.element(search).not.toBeInTheDocument();
        expect(terminals.searches.at(-1)).toBe('<end>');
    });

    it('offers case and regular expression options, and says when an expression cannot be read', async () => {
        const { screen, shell } = await renderFind();
        shell.openFind();
        await screen.getByRole('button', { name: 'Regular expression' }).click();
        await userEvent.type(screen.getByRole('searchbox', { name: 'Find' }), '(');
        await expect.element(screen.getByText('Not a valid regular expression.')).toBeVisible();
        await expect
            .element(screen.getByRole('button', { name: 'Match case' }))
            .toHaveAttribute('aria-pressed', 'false');
    });
});

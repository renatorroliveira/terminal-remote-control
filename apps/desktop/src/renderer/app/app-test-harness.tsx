import { createIntl } from 'react-intl';
import { expect } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import type { GuideSection } from '../../shared/guide';
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
import { App } from './App';
import { AppProviders } from './AppProviders';
import { NotificationCenter } from './notifications';
import { Shell } from './shell';

/** A connected host's state. */
export const CONNECTED = { status: 'connected', daemon: { version: '0.1.0', sha256: 'ab', proto: 1 } } as const;

/** Loads the Midnight tokens, as the app does; returns their removal. */
export function installTokens(): () => void {
    const tokens = document.createElement('style');
    tokens.textContent = themeStyleSheet();
    document.head.append(tokens);
    document.documentElement.dataset['theme'] = 'midnight';
    return () => {
        tokens.remove();
        delete document.documentElement.dataset['theme'];
    };
}

/** Renders the whole app over test doubles, with a shell recording what it saves and speaks. */
export function renderApp(savedWidth = 400) {
    const client = new FakeWorkspaceClient([bashSession('a')]);
    const terminals = new FakeTerminalHost([bashSession('b')]);
    const workspace = new WorkspaceController(client, terminals, new FakeKnownHostStore());
    const saved: (number | boolean)[] = [];
    const spoken: string[] = [];
    const guides: (GuideSection | undefined)[] = [];
    const shell = new Shell({
        workspace,
        terminals,
        sidebar: {
            width: () => Promise.resolve(savedWidth),
            setWidth: (width: number) => {
                saved.push(width);
                return Promise.resolve();
            },
            collapsed: () => Promise.resolve(false),
            setCollapsed: (collapsed: boolean) => {
                saved.push(collapsed);
                return Promise.resolve();
            },
        },
        announcer: { announce: (text: string) => spoken.push(text) },
        notifications: new NotificationCenter(() => 0),
        keymap: resolveKeymap({}),
        intl: createIntl({ locale: 'en', messages: messagesFor('en') }),
        document,
        isNarrow: () => window.innerWidth <= 800,
        guide: { open: (section) => guides.push(section) },
    });
    return {
        client,
        terminals,
        workspace,
        shell,
        saved,
        spoken,
        guides,
        rendered: render(
            <AppProviders locale="en">
                <App workspace={workspace} terminals={terminals} shell={shell} />
            </AppProviders>,
        ),
    };
}

/** Adds devbox-1 from the sidebar and reports it connected. */
export async function connectedHost(screen: AppScreen, client: FakeWorkspaceClient) {
    await screen.getByRole('combobox', { name: 'New host' }).fill('devbox-1');
    await userEvent.keyboard('{Enter}');
    client.push('host-0', CONNECTED);
    await expect.element(screen.getByRole('button', { name: 'New session on devbox-1' })).toBeVisible();
}

/** What {@link renderApp} renders. */
export type AppScreen = Awaited<ReturnType<typeof renderApp>['rendered']>;

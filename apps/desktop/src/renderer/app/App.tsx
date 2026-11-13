import { useState } from 'react';
import { Button } from 'react-aria-components';
import { FormattedMessage, useIntl } from 'react-intl';
import { useStore } from 'zustand';
import { APP_IDENTITY } from '../../shared/app-identity';
import { shellMessages } from '../i18n/messages';
import { ConnectionFailureDialog } from '../sessions/ConnectionFailureDialog';
import { sidebarMessages } from '../sessions/messages';
import { Sidebar } from '../sessions/Sidebar';
import type { WorkspaceController } from '../sessions/workspace-controller';
import styles from './App.module.css';

/** Where the terminal area hands its element. */
export interface TerminalArea {
    attach(area: HTMLElement | null): void;
}

/** What the shell shows. */
export interface AppProps {
    readonly workspace: WorkspaceController;
    readonly terminals: TerminalArea;
    /** Test builds also ask where the daemon installs (P-14). */
    readonly askInstallLocation?: boolean;
}

const SIDEBAR_ID = 'trc-sidebar';

/**
 * The application shell (US-1.6.1): the sidebar, 400 px wide and scrolling on its own, beside the terminal
 * area. In a narrow window the sidebar becomes a panel the Sessions button shows and hides (A11Y-07.5).
 */
export function App({ workspace, terminals, askInstallLocation = false }: AppProps) {
    const intl = useIntl();
    const [panelOpen, setPanelOpen] = useState(false);
    const open = useStore(workspace.store, (state) => state.open);

    return (
        <div className={styles['shell'] ?? ''} data-panel={panelOpen ? 'open' : 'closed'}>
            <h1 className={styles['title'] ?? ''}>{APP_IDENTITY.productName}</h1>
            <Sidebar
                id={SIDEBAR_ID}
                className={styles['sidebar'] ?? ''}
                workspace={workspace}
                onOpened={() => setPanelOpen(false)}
                askInstallLocation={askInstallLocation}
            />
            <main aria-label={APP_IDENTITY.productName} className={styles['content'] ?? ''}>
                <Button
                    className={styles['toggle'] ?? ''}
                    aria-controls={SIDEBAR_ID}
                    aria-expanded={panelOpen}
                    onPress={() => setPanelOpen((value) => !value)}
                >
                    {intl.formatMessage(sidebarMessages.toggle)}
                </Button>
                <div ref={(element) => terminals.attach(element)} className={styles['terminals'] ?? ''} />
                {open === undefined && (
                    <p className={styles['empty'] ?? ''}>
                        <FormattedMessage {...shellMessages.noSession} />
                    </p>
                )}
            </main>
            <ConnectionFailureDialog workspace={workspace} />
        </div>
    );
}

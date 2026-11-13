import { type CSSProperties, useEffect, useState } from 'react';
import { Button } from 'react-aria-components';
import { FormattedMessage, useIntl } from 'react-intl';
import { useStore } from 'zustand';
import { APP_IDENTITY } from '../../shared/app-identity';
import type { TrcBridge } from '../../shared/contract';
import { SIDEBAR_WIDTH } from '../../shared/layout';
import { shellMessages } from '../i18n/messages';
import { ConnectionFailureDialog } from '../sessions/ConnectionFailureDialog';
import { NEW_SESSION_ATTRIBUTE } from '../sessions/HostSessions';
import { sidebarMessages } from '../sessions/messages';
import { Sidebar } from '../sessions/Sidebar';
import type { WorkspaceController } from '../sessions/workspace-controller';
import { BUTTON } from '../ui/buttons';
import styles from './App.module.css';
import { SidebarSplitter } from './SidebarSplitter';

/** Where the terminal area hands its element. */
export interface TerminalArea {
    attach(area: HTMLElement | null): void;
}

/** Where the sidebar width is kept: `config.json` in the TRC home. */
export type SidebarWidthStore = TrcBridge['sidebar'];

/** What the shell shows. */
export interface AppProps {
    readonly workspace: WorkspaceController;
    readonly terminals: TerminalArea;
    readonly sidebar: SidebarWidthStore;
}

const SIDEBAR_ID = 'trc-sidebar';

/**
 * The application shell (US-1.6.1): the sidebar, scrolling on its own, beside the terminal area, with a splitter on
 * its edge that sets its width from 300 to 800 px (US-1.6.3). In a narrow window the sidebar becomes a panel the
 * Sessions and hosts button shows and hides (A11Y-07.5).
 */
export function App({ workspace, terminals, sidebar }: AppProps) {
    const intl = useIntl();
    const [panelOpen, setPanelOpen] = useState(false);
    const [width, setWidth] = useState<number>(SIDEBAR_WIDTH.initial);
    useEffect(() => {
        void sidebar.width().then(setWidth);
    }, [sidebar]);
    const open = useStore(workspace.store, (state) => state.open);
    useEffect(() => {
        if (open === undefined && document.activeElement === document.body) {
            document.querySelector<HTMLElement>(`[${NEW_SESSION_ATTRIBUTE}]`)?.focus();
        }
    }, [open]);

    return (
        <div
            className={styles['shell'] ?? ''}
            data-panel={panelOpen ? 'open' : 'closed'}
            style={{ '--trc-sidebar-width': `${width}px` } as CSSProperties}
        >
            <h1 className={styles['title'] ?? ''}>{APP_IDENTITY.productName}</h1>
            <Sidebar
                id={SIDEBAR_ID}
                className={styles['sidebar'] ?? ''}
                workspace={workspace}
                onOpened={() => setPanelOpen(false)}
            />
            <SidebarSplitter
                width={width}
                controls={SIDEBAR_ID}
                onResize={setWidth}
                onResized={(settled) => void sidebar.setWidth(settled)}
            />
            <main aria-label={APP_IDENTITY.productName} className={styles['content'] ?? ''}>
                <Button
                    className={`${BUTTON} ${styles['toggle'] ?? ''}`}
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

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { Button } from 'react-aria-components';
import { FormattedMessage, useIntl } from 'react-intl';
import { useStore } from 'zustand';
import { APP_IDENTITY } from '../../shared/app-identity';
import { SIDEBAR_WIDTH } from '../../shared/layout';
import { shellMessages } from '../i18n/messages';
import { ConnectionFailureDialog } from '../sessions/ConnectionFailureDialog';
import { ADD_HOST_ATTRIBUTE, HostDialogs } from '../sessions/HostDialogs';
import { sidebarMessages } from '../sessions/messages';
import { SessionDialogs } from '../sessions/SessionDialogs';
import { SESSION_TREE_ATTRIBUTE } from '../sessions/SessionTree';
import { Sidebar } from '../sessions/Sidebar';
import type { WorkspaceController } from '../sessions/workspace-controller';
import { BUTTON } from '../ui/buttons';
import styles from './App.module.css';
import { CommandPalette } from './CommandPalette';
import { LinkDialogs } from './LinkDialogs';
import { NotificationsDialog } from './NotificationsDialog';
import { PasteDialog } from './PasteDialog';
import { REGION_ATTRIBUTE } from './regions';
import { SidebarSplitter } from './SidebarSplitter';
import { StatusBar } from './StatusBar';
import type { Shell } from './shell';
import { ShellContext } from './shell-context';

/** Where the terminal area hands its element. */
export interface TerminalArea {
    attach(area: HTMLElement | null): void;
}

/** What the shell shows. */
export interface AppProps {
    readonly workspace: WorkspaceController;
    readonly terminals: TerminalArea;
    readonly shell: Shell;
}

const SIDEBAR_ID = 'trc-sidebar';

/**
 * The application shell (US-1.6.1): three regions, the sidebar, the terminal area and the status bar, that the
 * region shortcuts move between (A11Y-05.2). A splitter on the sidebar's edge sets its width from 300 to 800 px, and
 * Enter or the sidebar command hides it (US-1.6.3). In a narrow window the sidebar becomes a panel the Sessions and
 * hosts button shows and hides (A11Y-07.5). The command palette and the notification list open over it.
 */
export function App({ workspace, terminals, shell }: AppProps) {
    useEffect(() => shell.start(), [shell]);
    useFocusRescue(workspace);
    return (
        <ShellContext.Provider value={shell}>
            <div className={styles['shell'] ?? ''}>
                <h1 className={styles['title'] ?? ''}>{APP_IDENTITY.productName}</h1>
                <WorkspaceArea workspace={workspace} terminals={terminals} shell={shell} />
                <StatusBar workspace={workspace} shell={shell} />
                <ConnectionFailureDialog workspace={workspace} />
                <HostDialogs workspace={workspace} shell={shell} />
                <SessionDialogs workspace={workspace} shell={shell} />
                <CommandPalette shell={shell} workspace={workspace} />
                <NotificationsDialog shell={shell} />
                <LinkDialogs shell={shell} />
                <PasteDialog shell={shell} />
            </div>
        </ShellContext.Provider>
    );
}

function WorkspaceArea({ workspace, terminals, shell }: AppProps) {
    const panelOpen = useStore(shell.state, (state) => state.panelOpen);
    const sidebarCollapsed = useStore(shell.state, (state) => state.sidebarCollapsed);
    const [width, setWidth] = useSidebarWidth(shell);
    return (
        <div
            className={styles['workspace'] ?? ''}
            data-panel={panelOpen ? 'open' : 'closed'}
            data-sidebar={sidebarCollapsed ? 'hidden' : 'shown'}
            style={{ '--trc-sidebar-width': sidebarCollapsed ? '0px' : `${width}px` } as CSSProperties}
        >
            <Sidebar
                id={SIDEBAR_ID}
                className={styles['sidebar'] ?? ''}
                workspace={workspace}
                onOpened={() => shell.setPanelOpen(false)}
            />
            <SidebarSplitter
                width={width}
                controls={SIDEBAR_ID}
                collapsed={sidebarCollapsed}
                onToggleCollapsed={() => shell.toggleSidebar()}
                onResize={setWidth}
                onResized={(settled) => void shell.sidebar.setWidth(settled)}
            />
            <TerminalRegion workspace={workspace} terminals={terminals} shell={shell} />
        </div>
    );
}

function TerminalRegion({ workspace, terminals, shell }: AppProps) {
    const intl = useIntl();
    const panelOpen = useStore(shell.state, (state) => state.panelOpen);
    const open = useStore(workspace.store, (state) => state.open);
    const attach = useCallback((element: HTMLDivElement | null) => terminals.attach(element), [terminals]);
    return (
        <main
            {...{ [REGION_ATTRIBUTE]: 'terminal' }}
            aria-label={APP_IDENTITY.productName}
            className={styles['content'] ?? ''}
        >
            <Button
                className={`${BUTTON} ${styles['toggle'] ?? ''}`}
                aria-controls={SIDEBAR_ID}
                aria-expanded={panelOpen}
                onPress={() => shell.setPanelOpen(!panelOpen)}
            >
                {intl.formatMessage(sidebarMessages.toggle)}
            </Button>
            <div ref={attach} className={styles['terminals'] ?? ''} />
            {open === undefined && (
                <p className={styles['empty'] ?? ''}>
                    <FormattedMessage {...shellMessages.noSession} />
                </p>
            )}
        </main>
    );
}

function useSidebarWidth(shell: Shell): readonly [number, (width: number) => void] {
    const [width, setWidth] = useState<number>(SIDEBAR_WIDTH.initial);
    useEffect(() => {
        void shell.sidebar.width().then(setWidth);
    }, [shell]);
    return [width, setWidth];
}

function useFocusRescue(workspace: WorkspaceController): void {
    const open = useStore(workspace.store, (state) => state.open);
    useEffect(() => {
        if (open === undefined && document.activeElement === document.body) {
            const row = document.querySelector<HTMLElement>(`[${SESSION_TREE_ATTRIBUTE}] [tabindex="0"]`);
            (row ?? document.querySelector<HTMLElement>(`[${ADD_HOST_ATTRIBUTE}]`))?.focus();
        }
    }, [open]);
}

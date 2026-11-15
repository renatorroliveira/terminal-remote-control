import type { IntlShape } from 'react-intl';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { TrcBridge } from '../../shared/contract';
import type { RunningSessions, WorkspaceController } from '../sessions/workspace-controller';
import type { Announcer } from './announcer';
import type { NotificationCenter } from './notifications';
import { stopAllFailedMessage } from './quit-messages';

/** The quit dialog open now: the first-quit notice, or the confirmation of Quit and Stop All Sessions. */
export type QuitDialog =
    { readonly kind: 'first-quit' } | { readonly kind: 'stop-all'; readonly running: RunningSessions };

/** The quit flow's state. */
export interface QuitState {
    readonly dialog: QuitDialog | undefined;
    /** Whether the sessions are stopping. */
    readonly stopping: boolean;
}

/** The workspace operations quitting uses. */
export type QuitWorkspace = Pick<WorkspaceController, 'runningSessions' | 'stopAll'>;

/** What the quit flow needs. */
export interface QuitFlowOptions {
    readonly workspace: QuitWorkspace;
    readonly controls: Pick<TrcBridge['app'], 'quit' | 'quitNoticeOpened'>;
    readonly announcer: Pick<Announcer, 'announce'>;
    readonly notifications: NotificationCenter;
    readonly intl: IntlShape;
}

/**
 * Quitting (US-2.1): the first quit while sessions run shows a notice that they keep running, with Quit, Quit and
 * Stop All Sessions, and Cancel, never shown again (US-2.1.5, P-26); Quit and Stop All Sessions asks first, naming
 * the counts and the hosts it cannot reach, then stops every session and quits (US-2.1.4). A host that refuses keeps
 * the app open and is reported.
 */
export class QuitFlow {
    /** The dialog state the UI subscribes to. */
    readonly state: StoreApi<QuitState> = createStore<QuitState>(() => ({ dialog: undefined, stopping: false }));
    readonly #options: QuitFlowOptions;

    /** A quit flow over `options.workspace`. */
    constructor(options: QuitFlowOptions) {
        this.#options = options;
    }

    /** The user quit before the first-quit notice was shown: quits at once unless sessions run. */
    quitRequested(): void {
        if (!anyRunning(this.#options.workspace.runningSessions())) {
            this.quit();
            return;
        }
        this.state.setState({ dialog: { kind: 'first-quit' } });
        void this.#options.controls.quitNoticeOpened();
    }

    /** Quit and Stop All Sessions: asks first, or quits at once when no session runs. */
    requestStopAll(): void {
        const running = this.#options.workspace.runningSessions();
        if (!anyRunning(running)) {
            this.quit();
            return;
        }
        this.state.setState({ dialog: { kind: 'stop-all', running } });
    }

    /**
     * Stops every running session on every connected host, then quits; a host that refused keeps the app open, and so
     * does closing the dialog while the sessions stop.
     */
    async confirmStopAll(): Promise<void> {
        this.state.setState({ stopping: true });
        const failed = await this.#options.workspace.stopAll();
        const cancelled = this.state.getState().dialog?.kind !== 'stop-all';
        this.state.setState({ stopping: false });
        if (failed.length === 0) {
            if (!cancelled) {
                this.quit();
            }
            return;
        }
        this.state.setState({ dialog: undefined });
        const { intl, announcer, notifications } = this.#options;
        const text = intl.formatMessage(stopAllFailedMessage, { hosts: intl.formatList(failed) });
        announcer.announce(text, { politeness: 'assertive' });
        notifications.add({ text, level: 'error' });
    }

    /** Quits now, leaving the sessions running. */
    quit(): void {
        this.state.setState({ dialog: undefined });
        void this.#options.controls.quit();
    }

    /** Closes the dialog and keeps the app open. */
    cancel(): void {
        this.state.setState({ dialog: undefined });
    }
}

function anyRunning(running: RunningSessions): boolean {
    return running.sessions > 0 || running.unreachable.length > 0;
}

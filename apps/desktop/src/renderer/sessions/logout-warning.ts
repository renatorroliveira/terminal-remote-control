import { createStore, type StoreApi } from 'zustand/vanilla';

/** The warning's state: the host it asks about, while it is open. */
export interface LogoutWarningState {
    readonly hostId: string | undefined;
}

/**
 * The warning before the first session on a host that ends its sessions when its last connection closes (US-2.4.4):
 * {@link LogoutWarning.ask} opens it and resolves with the user's answer.
 */
export class LogoutWarning {
    /** The state the dialog subscribes to. */
    readonly state: StoreApi<LogoutWarningState> = createStore<LogoutWarningState>(() => ({ hostId: undefined }));
    #answer: ((create: boolean) => void) | undefined;

    /** Asks about `hostId`; resolves true when the user creates the session. A question still open is cancelled. */
    ask(hostId: string): Promise<boolean> {
        this.#answer?.(false);
        this.state.setState({ hostId });
        return new Promise((resolve) => {
            this.#answer = resolve;
        });
    }

    /** The user chose: create the session, or not. */
    answer(create: boolean): void {
        const answer = this.#answer;
        this.#answer = undefined;
        this.state.setState({ hostId: undefined });
        answer?.(create);
    }
}

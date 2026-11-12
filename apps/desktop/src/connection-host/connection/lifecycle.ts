import type {
    ConnectionFailure,
    ConnectionState,
    ConnectStep,
    DaemonInfo,
    LossReason,
    PresentedHostKey,
} from '../../shared/connection';

/** Something that happened to a host connection. */
export type LifecycleEvent =
    | { readonly type: 'connect' }
    | { readonly type: 'step'; readonly step: ConnectStep }
    | { readonly type: 'touch'; readonly text: string }
    | { readonly type: 'host-key'; readonly key: PresentedHostKey }
    | { readonly type: 'connected'; readonly daemon: DaemonInfo }
    | { readonly type: 'failed'; readonly failure: ConnectionFailure }
    | { readonly type: 'lost'; readonly reason: LossReason }
    | { readonly type: 'close' };

const RECONNECTABLE: ReadonlySet<ConnectionState['status']> = new Set(['idle', 'host-key', 'failed', 'disconnected']);

/** The connection lifecycle: a pure reducer, so every transition is explicit and testable. */
export function reduceConnection(state: ConnectionState, event: LifecycleEvent): ConnectionState {
    if (state.status === 'closed') {
        return state;
    }
    switch (event.type) {
        case 'close':
            return { status: 'closed' };
        case 'connect':
            return RECONNECTABLE.has(state.status)
                ? { status: 'connecting', step: 'connecting', touch: undefined }
                : state;
        case 'failed':
        case 'lost':
            return ending(state, event);
        default:
            return state.status === 'connecting' ? whileConnecting(state, event) : state;
    }
}

function ending(state: ConnectionState, event: Extract<LifecycleEvent, { type: 'failed' | 'lost' }>): ConnectionState {
    if (event.type === 'failed') {
        return state.status === 'connecting' || state.status === 'host-key'
            ? { status: 'failed', failure: event.failure }
            : state;
    }
    return state.status === 'connecting' || state.status === 'connected'
        ? { status: 'disconnected', reason: event.reason }
        : state;
}

function whileConnecting(
    state: Extract<ConnectionState, { status: 'connecting' }>,
    event: Extract<LifecycleEvent, { type: 'step' | 'touch' | 'host-key' | 'connected' }>,
): ConnectionState {
    switch (event.type) {
        case 'step':
            return { status: 'connecting', step: event.step, touch: undefined };
        case 'touch':
            return { ...state, touch: event.text };
        case 'host-key':
            return { status: 'host-key', key: event.key };
        case 'connected':
            return { status: 'connected', daemon: event.daemon };
    }
}

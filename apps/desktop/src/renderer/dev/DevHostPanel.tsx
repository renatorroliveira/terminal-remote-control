import { type RefObject, useEffect, useRef, useState } from 'react';
import { Button, Input, Label, TextField } from 'react-aria-components';
import type { ConnectionState } from '../../shared/connection';
import type { ThemeName } from '../../shared/display';
import type { HostClient } from '../connection/host-client';
import { SessionLink } from '../terminal/session-link';
import { TerminalView } from '../terminal/terminal-view';
import { THEMES } from '../ui/themes';
import styles from './DevHostPanel.module.css';

/** The host client operations the panel uses. */
export type DevHostClient = Pick<
    HostClient,
    'connect' | 'acceptHostKey' | 'onState' | 'request' | 'input' | 'credit' | 'onOutput'
>;

/** What the panel needs. */
export interface DevHostPanelProps {
    readonly client: DevHostClient;
    readonly isMac: boolean;
    /** Whether assistive technology is active, for the terminal's cadence. */
    readonly assistiveTechnology: () => boolean;
}

const DEFAULT_DESTINATION = 'trc-ubuntu';
const INSTALL_ROOT = '~/.trc';
const TERMINAL_HINT = 'Option F1: accessibility help.';

/**
 * A stand-in for the add-host dialog and session list until ST-12 and ST-13: connects one host and opens a
 * terminal on a new session. Only test builds render it, so its strings are not localized.
 */
export function DevHostPanel({ client, isMac, assistiveTechnology }: DevHostPanelProps) {
    const [destination, setDestination] = useState(DEFAULT_DESTINATION);
    const [hostId, setHostId] = useState<string>();
    const [state, setState] = useState<ConnectionState>({ status: 'idle' });
    const terminalHost = useRef<HTMLDivElement>(null);

    useEffect(() => (hostId === undefined ? undefined : client.onState(hostId, setState)), [client, hostId]);
    useTerminal({
        client,
        hostId,
        connected: state.status === 'connected',
        host: terminalHost,
        isMac,
        assistiveTechnology,
    });

    const connect = (): void => {
        const id = `dev-${destination}`;
        setHostId(id);
        client.connect(id, { destination, installRoot: INSTALL_ROOT });
    };

    return (
        <section className={styles['panel']} aria-labelledby="dev-host-heading">
            <h2 id="dev-host-heading">Test host</h2>
            <form
                className={styles['form']}
                onSubmit={(event) => {
                    event.preventDefault();
                    connect();
                }}
            >
                <TextField value={destination} onChange={setDestination} isRequired>
                    <Label>Destination</Label>
                    <Input />
                </TextField>
                <Button type="submit">Connect</Button>
            </form>
            <p role="status">{describeState(state)}</p>
            {state.status === 'host-key' && hostId !== undefined && (
                <Button onPress={() => client.acceptHostKey(hostId, state.key.fingerprint)}>
                    {`Trust ${state.key.fingerprint}`}
                </Button>
            )}
            <div ref={terminalHost} className={styles['terminal']} data-destination={destination} />
        </section>
    );
}

interface TerminalSlot {
    readonly client: DevHostClient;
    readonly hostId: string | undefined;
    readonly connected: boolean;
    readonly host: RefObject<HTMLDivElement | null>;
    readonly isMac: boolean;
    readonly assistiveTechnology: () => boolean;
}

function useTerminal({ client, hostId, connected, host, isMac, assistiveTechnology }: TerminalSlot): void {
    const sessionId = useRef<Promise<string>>(undefined);
    useEffect(() => {
        const element = host.current;
        if (!connected || hostId === undefined || element === null) {
            return undefined;
        }
        const view = createView(client, hostId, isMac, assistiveTechnology);
        view.view.mount(element);
        view.view.setLabel(`shell, ${element.dataset['destination'] ?? ''}`, TERMINAL_HINT);
        sessionId.current ??= view.link.create({ env: {} }).then((session) => session.id);
        void sessionId.current.then((id) => (view.link.attached ? undefined : view.link.attach(id)));
        return () => {
            view.link.dispose();
            view.view.dispose();
        };
    }, [client, hostId, connected, host, isMac, assistiveTechnology]);
}

function createView(client: DevHostClient, hostId: string, isMac: boolean, assistiveTechnology: () => boolean) {
    let view: TerminalView | undefined;
    const link = new SessionLink(client, hostId, (data) => void view?.write(data));
    view = new TerminalView({
        palette: THEMES[currentTheme()],
        isMac,
        assistiveTechnology,
        onInput: (text) => link.input(text),
        onCredit: (bytes) => link.credit(bytes),
        onResize: (size) => link.resize(size),
    });
    return { view, link };
}

function currentTheme(): ThemeName {
    const theme = document.documentElement.dataset['theme'];
    return theme !== undefined && theme in THEMES ? (theme as ThemeName) : 'light';
}

function describeState(state: ConnectionState): string {
    switch (state.status) {
        case 'idle':
            return 'Not connected.';
        case 'connecting':
            return state.touch === undefined ? `Connecting: ${state.step}` : state.touch;
        case 'host-key':
            return `Unknown host key ${state.key.type} ${state.key.fingerprint}`;
        case 'connected':
            return `Connected to trcd ${state.daemon.version}.`;
        case 'failed':
            return `Failed: ${state.failure.kind}. ${state.failure.details}`;
        case 'disconnected':
            return `Disconnected: ${state.reason}.`;
        case 'closed':
            return 'Closed.';
    }
}

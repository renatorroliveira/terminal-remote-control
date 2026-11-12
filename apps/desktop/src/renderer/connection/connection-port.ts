import { CONNECTION_PORT_MESSAGE } from '../../shared/connection-port';

/**
 * Calls `onPort` with each MessagePort to the connection host that the preload forwards to this page. Returns a
 * function that stops listening.
 */
export function receiveConnectionPorts(target: Window, onPort: (port: MessagePort) => void): () => void {
    const listener = (event: MessageEvent<unknown>): void => {
        const [port] = event.ports;
        if (event.source !== target || event.origin !== target.location.origin || port === undefined) {
            return;
        }
        if (isPortMessage(event.data)) {
            onPort(port);
        }
    };
    target.addEventListener('message', listener);
    return () => target.removeEventListener('message', listener);
}

function isPortMessage(data: unknown): boolean {
    return (
        typeof data === 'object' &&
        data !== null &&
        (data as { readonly type?: unknown }).type === CONNECTION_PORT_MESSAGE
    );
}

/**
 * Connection host entry: an Electron utilityProcess that owns every ssh child and daemon connection (ST-8). The main
 * process sends `init` with the first renderer port, a new port after every page load, and `wake` when the Mac wakes,
 * which, like a network change, reconnects waiting hosts at once (US-2.2.2).
 */
import type { MessagePortMain } from 'electron';
import type { HostEvent } from '../shared/connection';
import { HostConnection } from './connection/host-connection';
import { NetworkWatch } from './connection/network-watch';
import { parseInit } from './init';
import { ConnectionRouter } from './port/router';
import { createRuntime } from './runtime';

const ports = new Set<MessagePortMain>();
let router: ConnectionRouter | undefined;

process.parentPort.on('message', (event) => {
    if (isWake(event.data)) {
        router?.retryAll();
        return;
    }
    const [port] = event.ports;
    if (router === undefined) {
        const init = parseInit(event.data);
        if (init === undefined) {
            return;
        }
        const runtime = createRuntime(init);
        router = new ConnectionRouter(
            post,
            (hostId, target, listener) => new HostConnection(runtime, hostId, target, listener),
            runtime.log,
            init.localRoot,
        );
        const created = router;
        new NetworkWatch(() => created.retryAll()).start();
    }
    if (port !== undefined) {
        attach(port, router);
    }
});

function attach(port: MessagePortMain, target: ConnectionRouter): void {
    ports.add(port);
    port.on('message', (message) => target.handle(message.data));
    port.on('close', () => ports.delete(port));
    port.start();
}

function isWake(data: unknown): boolean {
    return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'wake';
}

function post(event: HostEvent): void {
    for (const port of ports) {
        port.postMessage(event);
    }
}

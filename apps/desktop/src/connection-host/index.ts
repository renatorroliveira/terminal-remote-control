/**
 * Connection host entry: an Electron utilityProcess that owns every ssh child and daemon connection (ST-8). The main
 * process sends `init` with the first renderer port, and a new port after every page load.
 */
import type { MessagePortMain } from 'electron';
import type { HostEvent } from '../shared/connection';
import { HostConnection } from './connection/host-connection';
import { parseInit } from './init';
import { ConnectionRouter } from './port/router';
import { createRuntime } from './runtime';

const ports = new Set<MessagePortMain>();
let router: ConnectionRouter | undefined;

process.parentPort.on('message', (event) => {
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
        );
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

function post(event: HostEvent): void {
    for (const port of ports) {
        port.postMessage(event);
    }
}

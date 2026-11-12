import { describe, expect, it } from 'vitest';
import { CONNECTION_PORT_MESSAGE } from '../../shared/connection-port';
import { receiveConnectionPorts } from './connection-port';

function nextTask(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('receiveConnectionPorts', () => {
    it('takes the port the preload forwards from this window', async () => {
        const ports: MessagePort[] = [];
        const stop = receiveConnectionPorts(window, (port) => ports.push(port));
        const channel = new MessageChannel();
        window.postMessage({ type: CONNECTION_PORT_MESSAGE }, window.location.origin, [channel.port2]);
        await nextTask();
        expect(ports).toHaveLength(1);
        stop();
    });

    it('ignores other messages and messages without a port', async () => {
        const ports: MessagePort[] = [];
        const stop = receiveConnectionPorts(window, (port) => ports.push(port));
        window.postMessage({ type: 'something-else' }, window.location.origin, [new MessageChannel().port2]);
        window.postMessage({ type: CONNECTION_PORT_MESSAGE }, window.location.origin);
        await nextTask();
        expect(ports).toEqual([]);
        stop();
    });
});

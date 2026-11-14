import type { NetworkInterfaceInfo } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkWatch } from './network-watch';

function address(cidr: string, internal = false): NetworkInterfaceInfo {
    return { address: cidr.split('/')[0] ?? '', netmask: '', family: 'IPv4', mac: '', internal, cidr };
}

describe('NetworkWatch (US-2.2.2)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('reports a new address or interface, such as a VPN, once', () => {
        let interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = { en0: [address('192.168.1.5/24')] };
        let changes = 0;
        const watch = new NetworkWatch(
            () => {
                changes += 1;
            },
            () => interfaces,
        );
        watch.start();
        vi.advanceTimersByTime(4_000);
        expect(changes).toBe(0);
        interfaces = { en0: [address('192.168.1.5/24')], utun3: [address('10.8.0.2/32')] };
        vi.advanceTimersByTime(2_000);
        vi.advanceTimersByTime(2_000);
        expect(changes).toBe(1);
        watch.stop();
    });

    it('ignores loopback and the order interfaces come in', () => {
        let interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = {
            en0: [address('192.168.1.5/24')],
            en1: [address('10.0.0.5/24')],
        };
        let changes = 0;
        const watch = new NetworkWatch(
            () => {
                changes += 1;
            },
            () => interfaces,
        );
        watch.start();
        interfaces = {
            lo0: [address('127.0.0.1/8', true)],
            en1: [address('10.0.0.5/24')],
            en0: [address('192.168.1.5/24')],
        };
        vi.advanceTimersByTime(2_000);
        expect(changes).toBe(0);
        watch.stop();
    });
});

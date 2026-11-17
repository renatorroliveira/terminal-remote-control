import { createIntl } from 'react-intl';
import { describe, expect, it } from 'vitest';
import type { ConnectionState } from '../../shared/connection';
import { messagesFor } from '../i18n/locale';
import { hostStateText } from './host-state-text';
import { EMPTY_WORKSPACE, type HostEntry, hostAdded } from './workspace-model';

const intl = createIntl({ locale: 'en', messages: messagesFor('en') });

function host(state: ConnectionState): HostEntry {
    const entry = hostAdded(EMPTY_WORKSPACE, {
        id: 'host-0',
        address: { destination: 'devbox-1' },
        installRoot: '~/.trc',
    }).hosts[0];
    if (entry === undefined) {
        throw new Error('no host');
    }
    return { ...entry, state };
}

const daemon = { version: '0.3.0', sha256: 'a', proto: 2 };

describe('hostStateText', () => {
    it('says Reconnecting while a lost host reconnects (US-2.2.2)', () => {
        const state: ConnectionState = { status: 'reconnecting', attempt: 1, nextAttemptAt: 0, failure: undefined };
        expect(hostStateText(intl, host(state))).toBe('Reconnecting');
    });

    it('says when a connected host ends its sessions as its last connection closes (US-2.4.4)', () => {
        const ending = { manager: 'systemd', sessionsEndAtLogout: true } as const;
        expect(hostStateText(intl, host({ status: 'connected', daemon: { ...daemon, service: ending } }))).toBe(
            'Connected; sessions end when its last connection closes',
        );
        const kept = { manager: 'detached', sessionsEndAtLogout: false } as const;
        expect(hostStateText(intl, host({ status: 'connected', daemon: { ...daemon, service: kept } }))).toBe(
            'Connected',
        );
        expect(hostStateText(intl, host({ status: 'connected', daemon }))).toBe('Connected');
    });

    it('says Daemon removed for a host whose daemon the user removed, and what a daemon change is doing', () => {
        expect(hostStateText(intl, { ...host({ status: 'closed' }), daemonRemoved: true })).toBe('Daemon removed');
        expect(hostStateText(intl, { ...host({ status: 'idle' }), daemonRemoved: true })).toBe('Daemon removed');
        const lost: ConnectionState = { status: 'disconnected', reason: 'channel-closed' };
        expect(hostStateText(intl, { ...host(lost), daemonAction: 'restarting' })).toBe('Restarting the daemon');
        expect(hostStateText(intl, { ...host({ status: 'closed' }), daemonAction: 'removing' })).toBe(
            'Removing the daemon',
        );
    });
});

import type { IntlShape, MessageDescriptor } from 'react-intl';
import { connectStepMessages, touchMessage } from './host-messages';
import { hostStateMessages } from './messages';
import type { HostEntry } from './workspace-model';

/**
 * A host's connection state as text, such as "Connected": while connecting, the current step (US-1.4.5), or the
 * security-key prompt while ssh waits for a touch (US-1.3.2); a connected host that ends its sessions when the last
 * connection closes says so (US-2.4.4); a host whose daemon the user removed, or that restarts or removes it, says
 * that instead (US-3.3.2, US-3.3.3, P-45).
 */
export function hostStateText(intl: IntlShape, host: HostEntry): string {
    const daemon = daemonStateMessage(host);
    if (daemon !== undefined) {
        return intl.formatMessage(daemon);
    }
    const state = host.state;
    if (state.status === 'connected' && state.daemon.service?.sessionsEndAtLogout === true) {
        return intl.formatMessage(hostStateMessages.connectedEndsAtLogout);
    }
    if (state.status === 'connecting') {
        return state.touch === undefined
            ? intl.formatMessage(connectStepMessages[state.step])
            : intl.formatMessage(touchMessage, { host: host.destination });
    }
    return intl.formatMessage(hostStateMessages[state.status === 'host-key' ? 'hostKey' : state.status]);
}

/** What a daemon change under way, or a removed daemon, says instead of the connection state (US-3.3, P-45). */
function daemonStateMessage(host: HostEntry): MessageDescriptor | undefined {
    const { status } = host.state;
    if (host.daemonAction === 'removing') {
        return hostStateMessages.removingDaemon;
    }
    if (host.daemonAction === 'restarting' && status !== 'connected') {
        return hostStateMessages.restartingDaemon;
    }
    return host.daemonRemoved === true && (status === 'idle' || status === 'closed')
        ? hostStateMessages.daemonRemoved
        : undefined;
}

import type { IntlShape } from 'react-intl';
import { connectStepMessages, touchMessage } from './host-messages';
import { hostStateMessages } from './messages';
import type { HostEntry } from './workspace-model';

/**
 * A host's connection state as text, such as "Connected": while connecting, the current step (US-1.4.5), or the
 * security-key prompt while ssh waits for a touch (US-1.3.2).
 */
export function hostStateText(intl: IntlShape, host: HostEntry): string {
    const state = host.state;
    if (state.status === 'connecting') {
        return state.touch === undefined
            ? intl.formatMessage(connectStepMessages[state.step])
            : intl.formatMessage(touchMessage, { host: host.destination });
    }
    return intl.formatMessage(hostStateMessages[state.status === 'host-key' ? 'hostKey' : state.status]);
}

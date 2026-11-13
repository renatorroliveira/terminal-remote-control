import type { IntlShape } from 'react-intl';
import { hostStateMessages } from './messages';
import type { HostEntry } from './workspace-model';

/** A host's connection state as text, such as "Connected" (US-1.6.2). */
export function hostStateText(intl: IntlShape, host: HostEntry): string {
    const status = host.state.status;
    return intl.formatMessage(hostStateMessages[status === 'host-key' ? 'hostKey' : status]);
}

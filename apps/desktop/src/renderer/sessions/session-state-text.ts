import type { IntlShape } from 'react-intl';
import { exitedCodeMessage, exitedSignalMessage, sessionDisconnectedMessage, sessionStateMessages } from './messages';
import type { SessionItem } from './workspace-model';

/**
 * A session's state as text, with the exit code or signal of an exited one (US-1.9.2, US-1.9.3), or Disconnected
 * while its host is not connected (US-1.14.1).
 */
export function sessionStateText(intl: IntlShape, item: SessionItem): string {
    if (item.disconnected) {
        return intl.formatMessage(sessionDisconnectedMessage);
    }
    const { state, exit } = item.session;
    if (state === 'exited' && exit?.code !== undefined) {
        return intl.formatMessage(exitedCodeMessage, { code: exit.code });
    }
    if (state === 'exited' && exit?.signal !== undefined) {
        return intl.formatMessage(exitedSignalMessage, { signal: exit.signal });
    }
    return intl.formatMessage(sessionStateMessages[state]);
}

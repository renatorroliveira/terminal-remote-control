import type { IntlShape } from 'react-intl';
import {
    exitedCodeMessage,
    exitedSignalMessage,
    sessionDisconnectedMessage,
    sessionReconnectingMessage,
    sessionStateMessages,
} from './messages';
import { endedMessages } from './restore-messages';
import type { SessionItem } from './workspace-model';

/**
 * A session's state as text, with the exit code or signal of an exited one (US-1.9.2, US-1.9.3), or Reconnecting or
 * Disconnected while its host is not connected (US-1.14.1, US-2.2.2), or what ended the processes of one that was
 * not restored (US-3.1.8).
 */
export function sessionStateText(
    intl: IntlShape,
    item: Pick<SessionItem, 'session' | 'disconnected' | 'reconnecting'>,
): string {
    if (item.disconnected && item.reconnecting) {
        return intl.formatMessage(sessionReconnectingMessage);
    }
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
    if (state === 'exited' && exit?.ended !== undefined) {
        return intl.formatMessage(endedMessages[exit.ended]);
    }
    return intl.formatMessage(sessionStateMessages[state]);
}

import type { IntlShape } from 'react-intl';
import { exitedCodeMessage, exitedSignalMessage, sessionStateMessages } from './messages';
import type { SessionItem } from './workspace-model';

/** A session's state as text, with the exit code or signal of an exited one (US-1.9.2, US-1.9.3). */
export function sessionStateText(intl: IntlShape, item: SessionItem): string {
    const { state, exit } = item.session;
    if (state === 'exited' && exit?.code !== undefined) {
        return intl.formatMessage(exitedCodeMessage, { code: exit.code });
    }
    if (state === 'exited' && exit?.signal !== undefined) {
        return intl.formatMessage(exitedSignalMessage, { signal: exit.signal });
    }
    return intl.formatMessage(sessionStateMessages[state]);
}

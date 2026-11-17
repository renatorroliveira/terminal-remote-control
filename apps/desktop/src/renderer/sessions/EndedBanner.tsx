import { Button } from 'react-aria-components';
import { useIntl } from 'react-intl';
import { useStore } from 'zustand';
import type { Shell } from '../app/shell';
import { BUTTON } from '../ui/buttons';
import styles from './EndedBanner.module.css';
import { endedSession } from './ended-session';
import { endedBannerMessages } from './session-messages';
import { sessionStateText } from './session-state-text';
import type { WorkspaceController } from './workspace-controller';

/** What the banner acts on. */
export interface EndedBannerProps {
    readonly workspace: WorkspaceController;
    readonly shell: Shell;
}

/**
 * A banner at the top of the terminal while the open session has ended (US-1.10.9): why it ended, then Restart
 * Session and Remove Session…, which asks first as Close does (US-1.10.4). It is a labelled region, reached with Tab
 * like any control, and never takes focus by itself; the session's state change is announced elsewhere.
 */
export function EndedBanner({ workspace, shell }: EndedBannerProps) {
    const intl = useIntl();
    const key = useStore(workspace.store, (state) => endedSession(state)?.key);
    const session = useStore(workspace.store, (state) => endedSession(state)?.session);
    if (key === undefined || session === undefined) {
        return null;
    }
    const item = { session, disconnected: false, reconnecting: false };
    const state = sessionStateText(intl, item);
    return (
        <section aria-label={intl.formatMessage(endedBannerMessages.region)} className={styles['banner']}>
            <p className={styles['text']}>{intl.formatMessage(endedBannerMessages.text, { state })}</p>
            <div className={styles['actions']}>
                <Button className={BUTTON} onPress={() => void workspace.restartSession(key)}>
                    {intl.formatMessage(endedBannerMessages.restart)}
                </Button>
                <Button className={BUTTON} onPress={() => shell.setSessionDialog({ kind: 'close', key })}>
                    {intl.formatMessage(endedBannerMessages.remove)}
                </Button>
            </div>
        </section>
    );
}

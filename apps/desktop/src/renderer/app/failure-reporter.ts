import type { IntlShape } from 'react-intl';
import type { StoreApi } from 'zustand/vanilla';
import type { ActionFailure, Workspace } from '../sessions/workspace-model';
import type { Announcer } from './announcer';
import type { NotificationCenter } from './notifications';
import { actionFailedMessage, failedActionMessages, failureReasonMessages } from './shell-messages';
import type { AudioCue } from './sound/audio-cues';

/** What the failure reporter needs from the shell. */
export interface FailureReporterOptions {
    readonly store: StoreApi<Workspace>;
    readonly intl: IntlShape;
    readonly announcer: Pick<Announcer, 'announce'>;
    readonly notifications: Pick<NotificationCenter, 'add'>;
    readonly playCue: (cue: AudioCue) => void;
}

/**
 * Reports each new action failure in the workspace: an error in the notification list, an assertive
 * announcement and the failure cue, so a refused action never fails silently (US-1.10, WCAG 3.3.1, A11Y-12.2).
 * Returns the function that stops watching.
 */
export function reportActionFailures(options: FailureReporterOptions): () => void {
    let reported = options.store.getState().actionFailure?.id;
    return options.store.subscribe((state) => {
        const failure = state.actionFailure;
        if (failure !== undefined && failure.id !== reported) {
            reported = failure.id;
            report(options, state, failure);
        }
    });
}

function report(options: FailureReporterOptions, state: Workspace, failure: ActionFailure): void {
    const { intl, announcer, notifications } = options;
    const host = state.hosts.find((entry) => entry.id === failure.hostId)?.destination ?? failure.hostId;
    const action = intl.formatMessage(failedActionMessages[failure.action], { host });
    const reason = intl.formatMessage(failureReasonMessages[failure.code]);
    const text = intl.formatMessage(actionFailedMessage, { action, reason });
    options.playCue('failed');
    notifications.add({ text, level: 'error' });
    announcer.announce(text, { group: `failure:${failure.hostId}`, politeness: 'assertive' });
}

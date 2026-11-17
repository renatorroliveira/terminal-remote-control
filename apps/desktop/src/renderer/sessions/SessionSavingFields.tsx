import type { SessionOptions } from '@trc/protocol';
import { type FormEvent, useId, useState } from 'react';
import { Button, Dialog, Heading } from 'react-aria-components';
import { useIntl } from 'react-intl';
import { BUTTON, PRIMARY_BUTTON } from '../ui/buttons';
import styles from '../ui/dialog.module.css';
import { ToggleSwitch } from '../ui/switches';
import { savingMessages } from './session-messages';
import type { WorkspaceController } from './workspace-controller';
import type { SessionItem } from './workspace-model';

/** What a new session restores and saves unless the user says otherwise (US-3.2.1, US-3.2.2). */
export const DEFAULT_SAVING: SessionOptions = { restore: true, saveScrollback: true };

/** What the saving switches show and change. */
export interface SessionSavingFieldsProps {
    readonly options: SessionOptions;
    readonly onChange: (options: SessionOptions) => void;
    readonly autoFocus?: boolean;
}

/** The "Restore after restart" and "Save scrollback to disk" switches, each described by what it does (US-3.2). */
export function SessionSavingFields({ options, onChange, autoFocus }: SessionSavingFieldsProps) {
    const intl = useIntl();
    const restoreHint = useId();
    const saveHint = useId();
    return (
        <>
            <div className={styles['field']}>
                <ToggleSwitch
                    isSelected={options.restore}
                    onChange={(restore) => onChange({ ...options, restore })}
                    aria-describedby={restoreHint}
                    autoFocus={autoFocus === true}
                >
                    {intl.formatMessage(savingMessages.restore)}
                </ToggleSwitch>
                <p id={restoreHint} className={styles['hint']}>
                    {intl.formatMessage(savingMessages.restoreHint)}
                </p>
            </div>
            <div className={styles['field']}>
                <ToggleSwitch
                    isSelected={options.saveScrollback}
                    onChange={(saveScrollback) => onChange({ ...options, saveScrollback })}
                    aria-describedby={saveHint}
                >
                    {intl.formatMessage(savingMessages.save)}
                </ToggleSwitch>
                <p id={saveHint} className={styles['hint']}>
                    {intl.formatMessage(savingMessages.saveHint)}
                </p>
            </div>
        </>
    );
}

/** What the Session settings dialog acts on. */
export interface SessionSettingsFormProps {
    readonly workspace: WorkspaceController;
    readonly item: SessionItem;
    readonly onClose: () => void;
}

/** Session settings…: what one session restores and saves, sent to its daemon on Save (US-3.2.1, US-3.2.2). */
export function SessionSettingsForm({ workspace, item, onClose }: SessionSettingsFormProps) {
    const intl = useIntl();
    const [options, setOptions] = useState(item.session.options ?? DEFAULT_SAVING);
    const save = (event: FormEvent): void => {
        event.preventDefault();
        onClose();
        void workspace.setSessionOptions(item.key, options);
    };
    return (
        <Dialog className={styles['dialog'] ?? ''}>
            <Heading slot="title" className={styles['heading'] ?? ''}>
                {intl.formatMessage(savingMessages.title, { session: item.label })}
            </Heading>
            <form onSubmit={save} className={styles['dialog'] ?? ''}>
                <SessionSavingFields options={options} onChange={setOptions} autoFocus />
                <div className={styles['actions']}>
                    <Button className={BUTTON} onPress={onClose}>
                        {intl.formatMessage(savingMessages.cancel)}
                    </Button>
                    <Button type="submit" className={PRIMARY_BUTTON}>
                        {intl.formatMessage(savingMessages.confirm)}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
}

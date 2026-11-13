import { type KeyboardEvent, useEffect, useState } from 'react';
import { Button } from 'react-aria-components';
import { type IntlShape, useIntl } from 'react-intl';
import { useStore } from 'zustand';
import {
    type Chord,
    COMMAND_IDS,
    type CommandId,
    chordFromKey,
    DEFAULT_KEYMAP,
    formatChord,
} from '../../../shared/keymap';
import { keymapFor, type Settings } from '../../../shared/settings';
import { BUTTON } from '../../ui/buttons';
import type { Shell } from '../shell';
import { commandMessages } from '../shell-messages';
import styles from './SettingsDialog.module.css';
import { bindingProblemMessages, settingLabelMessages, shortcutMessages } from './settings-messages';
import type { SettingsStore } from './settings-store';
import { shortcutRefusal } from './shortcut-refusal';

/** What the shortcut table edits. */
export interface ShortcutsSettingProps {
    readonly shell: Shell;
    readonly settings: SettingsStore;
}

const MODIFIER_KEYS: ReadonlySet<string> = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn']);

/**
 * The shortcut table (A11Y-05.7): each command with its shortcut, a Change button that records the next key press,
 * and Reset. A press that breaks a rule of docs/design/keymap.md, or that another command owns, is refused with the
 * reason; the menus' own shortcuts reach the recorder while it listens. Escape keeps the shortcut.
 */
export function ShortcutsSetting({ shell, settings }: ShortcutsSettingProps) {
    const intl = useIntl();
    const current = useStore(settings.state);
    const [recording, setRecording] = useState<CommandId | undefined>();
    const [status, setStatus] = useState('');
    const [refocus, setRefocus] = useState<CommandId | undefined>();
    const keymap = keymapFor(current);
    const name = (command: CommandId): string => intl.formatMessage(commandMessages[command]);
    const record = (command: CommandId | undefined): void => {
        setRefocus(command === undefined ? recording : undefined);
        setRecording(command);
        shell.ignoreMenuShortcuts(command !== undefined);
    };
    useEffect(() => {
        if (refocus !== undefined) {
            document.getElementById(changeButtonId(refocus))?.focus();
        }
    }, [refocus]);
    const reset = (command: CommandId): void => {
        const { [command]: _removed, ...shortcuts } = current.shortcuts;
        void settings.update({ shortcuts });
        const shortcut = DEFAULT_KEYMAP[command] ?? intl.formatMessage(shortcutMessages.none);
        setStatus(intl.formatMessage(shortcutMessages.resetDone, { command: name(command), shortcut }));
    };
    const pressed = (command: CommandId, chord: Chord): void => {
        const refusal = refusalFor(intl, current, command, chord);
        if (refusal !== undefined) {
            setStatus(refusal);
            return;
        }
        const shortcut = formatChord(chord);
        void settings.update({ shortcuts: { ...current.shortcuts, [command]: shortcut } });
        setStatus(intl.formatMessage(shortcutMessages.set, { command: name(command), shortcut }));
        record(undefined);
    };
    return (
        <div className={styles['setting']}>
            <table className={styles['shortcuts']}>
                <caption className={styles['label']}>{intl.formatMessage(settingLabelMessages.shortcuts)}</caption>
                <thead>
                    <tr>
                        <th scope="col">{intl.formatMessage(shortcutMessages.command)}</th>
                        <th scope="col">{intl.formatMessage(shortcutMessages.shortcut)}</th>
                        <th scope="col">{intl.formatMessage(shortcutMessages.actions)}</th>
                    </tr>
                </thead>
                <tbody>
                    {COMMAND_IDS.map((command) => (
                        <ShortcutRow
                            key={command}
                            command={command}
                            chord={keymap.chordFor(command)}
                            rebound={current.shortcuts[command] !== undefined}
                            recording={recording === command}
                            onChange={() => record(command)}
                            onReset={() => reset(command)}
                            onChord={(pressedChord) => pressed(command, pressedChord)}
                            onCancel={() => record(undefined)}
                            onLeave={() => {
                                setRecording(undefined);
                                shell.ignoreMenuShortcuts(false);
                            }}
                        />
                    ))}
                </tbody>
            </table>
            <p role="status" className={styles['description']}>
                {status}
            </p>
        </div>
    );
}

function ShortcutRow(props: {
    readonly command: CommandId;
    readonly chord: Chord | undefined;
    readonly rebound: boolean;
    readonly recording: boolean;
    readonly onChange: () => void;
    readonly onReset: () => void;
    readonly onChord: (chord: Chord) => void;
    readonly onCancel: () => void;
    readonly onLeave: () => void;
}) {
    const intl = useIntl();
    const command = intl.formatMessage(commandMessages[props.command]);
    return (
        <tr>
            <th scope="row">{command}</th>
            <td>
                <kbd className={styles['keys']}>
                    {props.chord === undefined ? intl.formatMessage(shortcutMessages.none) : formatChord(props.chord)}
                </kbd>
            </td>
            <td className={styles['rowActions']}>
                {props.recording ? (
                    <Recorder
                        label={intl.formatMessage(shortcutMessages.recording, { command })}
                        onChord={props.onChord}
                        onCancel={props.onCancel}
                        onLeave={props.onLeave}
                    />
                ) : (
                    <Button
                        id={changeButtonId(props.command)}
                        className={BUTTON}
                        aria-label={intl.formatMessage(shortcutMessages.changeLabel, { command })}
                        onPress={props.onChange}
                    >
                        {intl.formatMessage(shortcutMessages.change)}
                    </Button>
                )}
                <Button
                    className={BUTTON}
                    isDisabled={!props.rebound}
                    aria-label={intl.formatMessage(shortcutMessages.resetLabel, { command })}
                    onPress={props.onReset}
                >
                    {intl.formatMessage(shortcutMessages.reset)}
                </Button>
            </td>
        </tr>
    );
}

function Recorder(props: {
    readonly label: string;
    readonly onChord: (chord: Chord) => void;
    readonly onCancel: () => void;
    readonly onLeave: () => void;
}) {
    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
        if (MODIFIER_KEYS.has(event.key) || (event.key === 'Tab' && !event.metaKey && !event.ctrlKey)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
        const chord = chordFromKey(event.nativeEvent);
        if (event.key === 'Escape' && plain) {
            props.onCancel();
        } else if (chord !== undefined) {
            props.onChord(chord);
        }
    };
    return (
        // biome-ignore lint/a11y/noAutofocus: the recorder takes focus so the next key press reaches it (A11Y-05.7).
        <button type="button" autoFocus className={styles['recorder']} onKeyDown={onKeyDown} onBlur={props.onLeave}>
            {props.label}
        </button>
    );
}

function changeButtonId(command: CommandId): string {
    return `trc-shortcut-${command.replace('.', '-')}`;
}

function refusalFor(intl: IntlShape, settings: Settings, command: CommandId, chord: Chord): string | undefined {
    const refusal = shortcutRefusal(settings, command, chord);
    if (refusal === undefined) {
        return undefined;
    }
    if ('problem' in refusal) {
        return intl.formatMessage(bindingProblemMessages[refusal.problem]);
    }
    return intl.formatMessage(shortcutMessages.taken, {
        shortcut: formatChord(chord),
        command: intl.formatMessage(commandMessages[refusal.owner]),
    });
}

import { type ReactNode, useId, useState } from 'react';
import { type IntlShape, useIntl } from 'react-intl';
import { useStore } from 'zustand';
import type { ScreenReaderMode } from '../../../shared/accessibility';
import type { ThemePreference } from '../../../shared/display';
import { SETTINGS_LIMITS, type Settings } from '../../../shared/settings';
import { TERMINAL_APPEARANCE_LIMITS, type TerminalAppearance } from '../../../shared/terminal-appearance';
import { TERMINAL_ZOOM } from '../../../shared/terminal-zoom';
import type { WorkspaceController } from '../../sessions/workspace-controller';
import type { Shell } from '../shell';
import styles from './SettingsDialog.module.css';
import { ShortcutsSetting } from './ShortcutsSetting';
import { ChoiceSetting, NumberSetting, SwitchSetting } from './setting-fields';
import { SETTING_ENTRIES, type SettingId } from './settings-catalog';
import { settingChoiceMessages as choice, settingLabelMessages } from './settings-messages';
import type { SettingsStore } from './settings-store';

/** What a setting's control works on. */
export interface SettingControlProps {
    readonly id: SettingId;
    readonly shell: Shell;
    readonly settings: SettingsStore;
    readonly workspace: WorkspaceController;
}

interface Context {
    readonly intl: IntlShape;
    readonly settings: Settings;
    readonly update: (change: Partial<Settings>) => void;
    readonly appearance: (change: Partial<TerminalAppearance>) => void;
}

/** The control of one setting on the settings page (A11Y-10.3). */
export function SettingControl({ id, shell, settings, workspace }: SettingControlProps) {
    const intl = useIntl();
    const current = useStore(settings.state);
    if (id === 'screenReaderMode') {
        return <ScreenReaderModeSetting shell={shell} />;
    }
    if (id === 'clipboardWrites') {
        return <ClipboardWritesSetting workspace={workspace} />;
    }
    if (id === 'shortcuts') {
        return <ShortcutsSetting shell={shell} settings={settings} />;
    }
    const context: Context = {
        intl,
        settings: current,
        update: (change) => void settings.update(change),
        appearance: (change) =>
            void settings.update({ terminalAppearance: { ...settings.current.terminalAppearance, ...change } }),
    };
    return RENDERERS[id](context);
}

type Renderer = (context: Context) => ReactNode;

const APPEARANCE = TERMINAL_APPEARANCE_LIMITS;

const RENDERERS: Readonly<Record<Exclude<SettingId, 'screenReaderMode' | 'clipboardWrites' | 'shortcuts'>, Renderer>> =
    {
        plainF6: ({ intl, settings, update }) => (
            <SwitchSetting
                {...text(intl, 'plainF6')}
                isSelected={settings.plainF6}
                onChange={(plainF6) => update({ plainF6 })}
            />
        ),
        verbosity: ({ intl, settings, update }) => (
            <ChoiceSetting
                {...text(intl, 'verbosity')}
                value={settings.verbosity}
                choices={[
                    { value: 'detailed', label: intl.formatMessage(choice.detailed) },
                    { value: 'brief', label: intl.formatMessage(choice.brief) },
                ]}
                onChange={(verbosity) => update({ verbosity })}
            />
        ),
        hints: ({ intl, settings, update }) => (
            <SwitchSetting
                {...text(intl, 'hints')}
                isSelected={settings.hints}
                onChange={(hints) => update({ hints })}
            />
        ),
        floodThreshold: ({ intl, settings, update }) => (
            <NumberSetting
                {...text(intl, 'floodThreshold')}
                value={settings.floodThreshold}
                {...range(SETTINGS_LIMITS.floodThreshold, 1)}
                onChange={(floodThreshold) => update({ floodThreshold })}
            />
        ),
        theme: ({ intl, settings, update }) => (
            <ChoiceSetting<ThemePreference>
                {...text(intl, 'theme')}
                value={settings.theme}
                choices={[
                    { value: 'midnight', label: intl.formatMessage(choice.midnight) },
                    { value: 'system', label: intl.formatMessage(choice.system) },
                    { value: 'light', label: intl.formatMessage(choice.light) },
                    { value: 'dark', label: intl.formatMessage(choice.dark) },
                    { value: 'hc-light', label: intl.formatMessage(choice.hcLight) },
                    { value: 'hc-dark', label: intl.formatMessage(choice.hcDark) },
                ]}
                onChange={(theme) => update({ theme })}
            />
        ),
        minimumContrast: ({ intl, settings, update }) => (
            <ChoiceSetting
                {...text(intl, 'minimumContrast')}
                value={settings.minimumContrast}
                choices={[
                    { value: 4.5, label: intl.formatMessage(choice.contrastAa) },
                    { value: 7, label: intl.formatMessage(choice.contrastAaa) },
                ]}
                onChange={(minimumContrast) => update({ minimumContrast })}
            />
        ),
        terminalZoom: ({ intl, settings, update }) => (
            <NumberSetting
                {...text(intl, 'terminalZoom')}
                value={settings.terminalZoom}
                {...range(TERMINAL_ZOOM, TERMINAL_ZOOM.step)}
                onChange={(terminalZoom) => update({ terminalZoom })}
            />
        ),
        lineHeight: ({ intl, settings, appearance }) => (
            <NumberSetting
                {...text(intl, 'lineHeight')}
                value={settings.terminalAppearance.lineHeight}
                {...range(APPEARANCE.lineHeight, 0.1)}
                onChange={(lineHeight) => appearance({ lineHeight })}
            />
        ),
        letterSpacing: ({ intl, settings, appearance }) => (
            <NumberSetting
                {...text(intl, 'letterSpacing')}
                value={settings.terminalAppearance.letterSpacing}
                {...range(APPEARANCE.letterSpacing, 1)}
                onChange={(letterSpacing) => appearance({ letterSpacing })}
            />
        ),
        cursorStyle: ({ intl, settings, appearance }) => (
            <ChoiceSetting
                {...text(intl, 'cursorStyle')}
                value={settings.terminalAppearance.cursorStyle}
                choices={[
                    { value: 'block', label: intl.formatMessage(choice.block) },
                    { value: 'bar', label: intl.formatMessage(choice.bar) },
                    { value: 'underline', label: intl.formatMessage(choice.underline) },
                ]}
                onChange={(cursorStyle) => appearance({ cursorStyle })}
            />
        ),
        cursorWidth: ({ intl, settings, appearance }) => (
            <NumberSetting
                {...text(intl, 'cursorWidth')}
                value={settings.terminalAppearance.cursorWidth}
                {...range(APPEARANCE.cursorWidth, 1)}
                onChange={(cursorWidth) => appearance({ cursorWidth })}
            />
        ),
        cursorBlink: ({ intl, settings, appearance }) => (
            <SwitchSetting
                {...text(intl, 'cursorBlink')}
                isSelected={settings.terminalAppearance.cursorBlink}
                onChange={(cursorBlink) => appearance({ cursorBlink })}
            />
        ),
        tabFocusMode: ({ intl, settings, update }) => (
            <SwitchSetting
                {...text(intl, 'tabFocusMode')}
                isSelected={settings.tabFocusMode}
                onChange={(tabFocusMode) => update({ tabFocusMode })}
            />
        ),
        newSessionFolder: ({ intl, settings, update }) => (
            <ChoiceSetting
                {...text(intl, 'newSessionFolder')}
                value={settings.newSessionFolder}
                choices={[
                    { value: 'home', label: intl.formatMessage(choice.home) },
                    { value: 'open-session', label: intl.formatMessage(choice.openSession) },
                ]}
                onChange={(newSessionFolder) => update({ newSessionFolder })}
            />
        ),
        scrollbackLines: ({ intl, settings, update }) => (
            <NumberSetting
                {...text(intl, 'scrollbackLines')}
                value={settings.scrollbackLines}
                {...range(SETTINGS_LIMITS.scrollbackLines, 1_000)}
                onChange={(scrollbackLines) => update({ scrollbackLines })}
            />
        ),
        stopGraceSeconds: ({ intl, settings, update }) => (
            <NumberSetting
                {...text(intl, 'stopGraceSeconds')}
                value={settings.stopGraceSeconds}
                {...range(SETTINGS_LIMITS.stopGraceSeconds, 1)}
                onChange={(stopGraceSeconds) => update({ stopGraceSeconds })}
            />
        ),
        autoClose: ({ intl, settings, update }) => (
            <SwitchSetting
                {...text(intl, 'autoClose')}
                isSelected={settings.autoClose}
                onChange={(autoClose) => update({ autoClose })}
            />
        ),
        pasteConfirmation: ({ intl, settings, update }) => (
            <SwitchSetting
                {...text(intl, 'pasteConfirmation')}
                isSelected={settings.pasteConfirmation}
                onChange={(pasteConfirmation) => update({ pasteConfirmation })}
            />
        ),
    };

function ScreenReaderModeSetting({ shell }: { readonly shell: Shell }) {
    const intl = useIntl();
    const [mode, setMode] = useState<ScreenReaderMode>(shell.screenReaderMode ?? 'auto');
    return (
        <ChoiceSetting<ScreenReaderMode>
            {...text(intl, 'screenReaderMode')}
            value={mode}
            choices={[
                { value: 'auto', label: intl.formatMessage(choice.srAuto) },
                { value: 'on', label: intl.formatMessage(choice.srOn) },
                { value: 'off', label: intl.formatMessage(choice.srOff) },
            ]}
            onChange={(chosen) => {
                setMode(chosen);
                void shell.setScreenReaderMode(chosen);
            }}
        />
    );
}

function ClipboardWritesSetting({ workspace }: { readonly workspace: WorkspaceController }) {
    const intl = useIntl();
    const hosts = useStore(workspace.store, (state) => state.hosts);
    const descriptionId = useId();
    const { label, description } = text(intl, 'clipboardWrites');
    return (
        <fieldset className={styles['hosts']} aria-describedby={descriptionId}>
            <legend className={styles['label']}>{label}</legend>
            {hosts.map((host) => (
                <SwitchSetting
                    key={host.id}
                    label={host.destination}
                    isSelected={host.allowClipboardWrites === true}
                    onChange={(allowed) => void workspace.setClipboardWrites(host.id, allowed)}
                />
            ))}
            <p id={descriptionId} className={styles['description']}>
                {description}
            </p>
        </fieldset>
    );
}

function text(intl: IntlShape, id: SettingId): { label: string; description?: string } {
    const description = SETTING_ENTRIES.find((entry) => entry.id === id)?.description;
    return {
        label: intl.formatMessage(settingLabelMessages[id]),
        ...(description === undefined ? {} : { description: intl.formatMessage(description) }),
    };
}

function range(limits: { readonly min: number; readonly max: number }, step: number) {
    return { min: limits.min, max: limits.max, step };
}

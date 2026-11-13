import type { MenuItemConstructorOptions } from 'electron';
import type { AppCommand } from '../shared/contract';
import type { ThemePreference } from '../shared/display';
import { MAIN_STRINGS } from './strings';

/** What the menu needs. */
export interface MenuOptions {
    readonly appName: string;
    /** Sends a command to the renderer. */
    readonly onCommand: (command: AppCommand) => void;
    /** Shows the macOS Look Up panel for the focused page's selection. */
    readonly onLookUp: () => void;
    /** The theme picked now, checked in View > Theme. */
    readonly themePreference: ThemePreference;
    /** Picks a theme, or `system` to follow the OS (A11Y-07.3). */
    readonly onThemePreference: (theme: ThemePreference) => void;
}

const THEME_CHOICES: readonly (readonly [ThemePreference, string] | 'separator')[] = [
    ['midnight', MAIN_STRINGS.themeMidnight],
    ['system', MAIN_STRINGS.themeSystem],
    'separator',
    ['light', MAIN_STRINGS.themeLight],
    ['dark', MAIN_STRINGS.themeDark],
    ['hc-light', MAIN_STRINGS.themeHighContrastLight],
    ['hc-dark', MAIN_STRINGS.themeHighContrastDark],
];

/**
 * The menu bar: the standard macOS menus, Edit with Look Up and Speech, zoom in View, and Help with the user guide
 * and accessibility help.
 */
export function menuTemplate(options: MenuOptions): MenuItemConstructorOptions[] {
    return [
        {
            label: options.appName,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' },
            ],
        },
        editMenu(options),
        {
            label: MAIN_STRINGS.viewMenu,
            submenu: [
                { label: MAIN_STRINGS.theme, submenu: themeMenu(options) },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' },
            ],
        },
        { role: 'windowMenu' },
        {
            role: 'help',
            submenu: [
                { label: MAIN_STRINGS.userGuide, click: () => options.onCommand('help.userGuide') },
                {
                    label: MAIN_STRINGS.accessibilityHelp,
                    accelerator: 'Alt+F1',
                    click: () => options.onCommand('help.accessibility'),
                },
            ],
        },
    ];
}

function editMenu(options: MenuOptions): MenuItemConstructorOptions {
    return {
        label: MAIN_STRINGS.editMenu,
        submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' },
            { type: 'separator' },
            { label: MAIN_STRINGS.lookUp, accelerator: 'Ctrl+Cmd+D', click: () => options.onLookUp() },
            { type: 'separator' },
            { label: MAIN_STRINGS.speech, submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] },
        ],
    };
}

function themeMenu(options: MenuOptions): MenuItemConstructorOptions[] {
    return THEME_CHOICES.map((choice) =>
        choice === 'separator'
            ? { type: 'separator' }
            : {
                  label: choice[1],
                  type: 'radio',
                  checked: choice[0] === options.themePreference,
                  click: () => options.onThemePreference(choice[0]),
              },
    );
}

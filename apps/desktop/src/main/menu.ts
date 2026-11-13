import type { MenuItemConstructorOptions } from 'electron';
import type { AppCommand } from '../shared/contract';
import type { ThemePreference } from '../shared/display';
import { type CommandId, type Keymap, menuAccelerator } from '../shared/keymap';
import { MAIN_STRINGS } from './strings';

/** What the menu needs. */
export interface MenuOptions {
    readonly appName: string;
    /** The shortcuts in force; the menus show the Command ones (docs/design/keymap.md, rule 7). */
    readonly keymap: Keymap;
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
 * The menu bar: the standard macOS menus; Session with new, next and previous session; Edit with Look Up and Speech; View with the command palette, notifications,
 * the sidebar, regions, the theme and zoom; Terminal with Tab focus mode, send next key, mute, list links and the text size; and Help with the
 * user guide and accessibility help. Each command shows its Command shortcut and runs in the renderer.
 */
export function menuTemplate(options: MenuOptions): MenuItemConstructorOptions[] {
    return [
        {
            label: options.appName,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                command(options, 'settings.show', MAIN_STRINGS.settings),
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
        {
            label: MAIN_STRINGS.sessionMenu,
            submenu: [
                command(options, 'session.new', MAIN_STRINGS.newSession),
                command(options, 'session.newWithOptions', MAIN_STRINGS.newSessionWithOptions),
                { type: 'separator' },
                command(options, 'session.next', MAIN_STRINGS.nextSession),
                command(options, 'session.previous', MAIN_STRINGS.previousSession),
            ],
        },
        editMenu(options),
        {
            label: MAIN_STRINGS.viewMenu,
            submenu: [
                command(options, 'palette.show', MAIN_STRINGS.commandPalette),
                command(options, 'notifications.show', MAIN_STRINGS.showNotifications),
                { type: 'separator' },
                command(options, 'sidebar.toggle', MAIN_STRINGS.toggleSidebar),
                command(options, 'region.next', MAIN_STRINGS.nextRegion),
                command(options, 'region.previous', MAIN_STRINGS.previousRegion),
                { type: 'separator' },
                { label: MAIN_STRINGS.theme, submenu: themeMenu(options) },
                { type: 'separator' },
                { role: 'resetZoom', accelerator: 'Control+Command+0' },
                { role: 'zoomIn', accelerator: 'Control+Command+=' },
                { role: 'zoomOut', accelerator: 'Control+Command+-' },
                { type: 'separator' },
                { role: 'togglefullscreen' },
            ],
        },
        {
            label: MAIN_STRINGS.terminalMenu,
            submenu: [
                command(options, 'terminal.toggleTabFocus', MAIN_STRINGS.tabMovesFocus),
                command(options, 'terminal.sendNextKey', MAIN_STRINGS.sendNextKey),
                command(options, 'announcements.toggleMute', MAIN_STRINGS.muteAnnouncements),
                command(options, 'terminal.listLinks', MAIN_STRINGS.listLinks),
                command(options, 'review.toggle', MAIN_STRINGS.reviewMode),
                command(options, 'terminal.find', MAIN_STRINGS.find),
                { type: 'separator' },
                command(options, 'terminal.zoomIn', MAIN_STRINGS.biggerText),
                command(options, 'terminal.zoomOut', MAIN_STRINGS.smallerText),
                command(options, 'terminal.zoomReset', MAIN_STRINGS.defaultTextSize),
            ],
        },
        { role: 'windowMenu' },
        {
            role: 'help',
            submenu: [
                command(options, 'help.userGuide', MAIN_STRINGS.userGuide),
                command(options, 'help.accessibility', MAIN_STRINGS.accessibilityHelp),
            ],
        },
    ];
}

/** The terminal's context menu: Copy (with a selection), Paste, List Links and Look Up (A11Y-11.11, US-1.12). */
export function terminalContextMenu(
    options: Pick<MenuOptions, 'keymap' | 'onCommand' | 'onLookUp'>,
    canCopy: boolean,
): MenuItemConstructorOptions[] {
    return [
        { role: 'copy', enabled: canCopy },
        { role: 'paste' },
        { type: 'separator' },
        command(options, 'terminal.listLinks', MAIN_STRINGS.listLinks),
        { label: MAIN_STRINGS.lookUp, enabled: canCopy, click: () => options.onLookUp() },
    ];
}

function command(
    options: Pick<MenuOptions, 'keymap' | 'onCommand'>,
    id: CommandId,
    label: string,
): MenuItemConstructorOptions {
    const chord = options.keymap.chordFor(id);
    const accelerator = chord === undefined ? undefined : menuAccelerator(chord);
    return { label, ...(accelerator === undefined ? {} : { accelerator }), click: () => options.onCommand(id) };
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

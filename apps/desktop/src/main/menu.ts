import type { MenuItemConstructorOptions } from 'electron';
import type { AppCommand } from '../shared/contract';
import type { ThemePreference } from '../shared/display';
import { type CommandId, type Keymap, type KeymapPlatform, menuAccelerator } from '../shared/keymap';
import { MAIN_STRINGS } from './strings';

/** An editing action the Windows Edit menu runs on the focused page, without the shortcuts the shell owns. */
export type EditAction = 'undo' | 'redo' | 'cut' | 'selectAll';

/** A change to the whole window's zoom (A11Y-07.4). */
export type PageZoom = 'in' | 'out' | 'reset';

/** What the menu needs. */
export interface MenuOptions {
    readonly appName: string;
    /** Whose menu conventions to follow (D-67): macOS's app menu, or Windows' File to Help. */
    readonly platform: KeymapPlatform;
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
    /** Runs an editing action on the focused page (Windows). */
    readonly onEdit: (action: EditAction) => void;
    /** Zooms the whole window (Windows, where its default keys are the terminal text size's). */
    readonly onPageZoom: (zoom: PageZoom) => void;
    /** Turns full screen on or off (Windows, where F11 stays with the terminal). */
    readonly onFullScreen: () => void;
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
 * The menu bar of the platform the options name. On macOS: the standard menus; Session with new, next, previous and
 * close session; Edit with Look Up and Speech; View with the command palette, notifications, the sidebar, regions, the
 * theme and zoom; Terminal with Tab focus mode, send next key, mute, list links and the text size; and Help with the
 * user guide and accessibility help. On Windows: File, Edit, View, Terminal and Help, with access keys, Settings and
 * Exit under File and About under Help (P-92). Each command shows its shortcut and runs in the renderer.
 */
export function menuTemplate(options: MenuOptions): MenuItemConstructorOptions[] {
    return options.platform === 'windows' ? windowsMenuTemplate(options) : macMenuTemplate(options);
}

/**
 * The Windows menu bar (US-6.1.3, P-92): File with the session commands, Settings and Exit; Edit with Copy and Paste
 * on Ctrl+Shift+C and Ctrl+Shift+V (P-86) and the other edits without the Control keys the shell owns; View; Terminal;
 * and Help with the user guide, accessibility help and About. Each top menu has its access key.
 */
export function windowsMenuTemplate(options: MenuOptions): MenuItemConstructorOptions[] {
    return [
        {
            label: `&${MAIN_STRINGS.fileMenu}`,
            submenu: [
                ...sessionItems(options),
                { type: 'separator' },
                command(options, 'settings.show', MAIN_STRINGS.settings),
                { type: 'separator' },
                command(options, 'app.quitAndStopAll', MAIN_STRINGS.exitAndStopAll),
                { role: 'quit', label: MAIN_STRINGS.exit },
            ],
        },
        {
            label: `&${MAIN_STRINGS.editMenu}`,
            submenu: [
                { label: MAIN_STRINGS.undo, click: () => options.onEdit('undo') },
                { label: MAIN_STRINGS.redo, click: () => options.onEdit('redo') },
                { type: 'separator' },
                { label: MAIN_STRINGS.cut, click: () => options.onEdit('cut') },
                { role: 'copy', label: MAIN_STRINGS.copy, accelerator: 'Ctrl+Shift+C' },
                { role: 'paste', label: MAIN_STRINGS.paste, accelerator: 'Ctrl+Shift+V' },
                { label: MAIN_STRINGS.selectAll, click: () => options.onEdit('selectAll') },
                { type: 'separator' },
                command(options, 'terminal.clearScrollback', MAIN_STRINGS.clearScrollback),
            ],
        },
        {
            label: `&${MAIN_STRINGS.viewMenu}`,
            submenu: [
                ...viewCommandItems(options),
                { type: 'separator' },
                { label: MAIN_STRINGS.actualSize, click: () => options.onPageZoom('reset') },
                { label: MAIN_STRINGS.zoomIn, click: () => options.onPageZoom('in') },
                { label: MAIN_STRINGS.zoomOut, click: () => options.onPageZoom('out') },
                { type: 'separator' },
                { label: MAIN_STRINGS.fullScreen, click: () => options.onFullScreen() },
            ],
        },
        { label: `&${MAIN_STRINGS.terminalMenu}`, submenu: terminalItems(options) },
        {
            label: `&${MAIN_STRINGS.helpMenu}`,
            submenu: [
                command(options, 'help.userGuide', MAIN_STRINGS.userGuide),
                command(options, 'help.accessibility', MAIN_STRINGS.accessibilityHelp),
                { type: 'separator' },
                { role: 'about', label: MAIN_STRINGS.about },
            ],
        },
    ];
}

function macMenuTemplate(options: MenuOptions): MenuItemConstructorOptions[] {
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
                command(options, 'app.quitAndStopAll', MAIN_STRINGS.quitAndStopAll),
                { role: 'quit' },
            ],
        },
        { label: MAIN_STRINGS.sessionMenu, submenu: sessionItems(options) },
        editMenu(options),
        {
            label: MAIN_STRINGS.viewMenu,
            submenu: [
                ...viewCommandItems(options),
                { type: 'separator' },
                { role: 'resetZoom', accelerator: 'Control+Command+0' },
                { role: 'zoomIn', accelerator: 'Control+Command+=' },
                { role: 'zoomOut', accelerator: 'Control+Command+-' },
                { type: 'separator' },
                { role: 'togglefullscreen' },
            ],
        },
        { label: MAIN_STRINGS.terminalMenu, submenu: terminalItems(options) },
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

function sessionItems(options: MenuOptions): MenuItemConstructorOptions[] {
    return [
        command(options, 'session.new', MAIN_STRINGS.newSession),
        command(options, 'session.newWithOptions', MAIN_STRINGS.newSessionWithOptions),
        { type: 'separator' },
        command(options, 'session.next', MAIN_STRINGS.nextSession),
        command(options, 'session.previous', MAIN_STRINGS.previousSession),
        command(options, 'session.quickSwitch', MAIN_STRINGS.goToSession),
        { type: 'separator' },
        command(options, 'session.close', MAIN_STRINGS.closeSession),
    ];
}

function viewCommandItems(options: MenuOptions): MenuItemConstructorOptions[] {
    return [
        command(options, 'palette.show', MAIN_STRINGS.commandPalette),
        command(options, 'notifications.show', MAIN_STRINGS.showNotifications),
        { type: 'separator' },
        command(options, 'sidebar.toggle', MAIN_STRINGS.toggleSidebar),
        command(options, 'region.next', MAIN_STRINGS.nextRegion),
        command(options, 'region.previous', MAIN_STRINGS.previousRegion),
        { type: 'separator' },
        { label: MAIN_STRINGS.theme, submenu: themeMenu(options) },
    ];
}

function terminalItems(options: MenuOptions): MenuItemConstructorOptions[] {
    return [
        command(options, 'terminal.toggleTabFocus', MAIN_STRINGS.tabMovesFocus),
        command(options, 'terminal.sendNextKey', MAIN_STRINGS.sendNextKey),
        command(options, 'announcements.toggleMute', MAIN_STRINGS.muteAnnouncements),
        command(options, 'terminal.listLinks', MAIN_STRINGS.listLinks),
        command(options, 'review.toggle', MAIN_STRINGS.reviewMode),
        command(options, 'terminal.find', MAIN_STRINGS.find),
        { type: 'separator' },
        command(options, 'command.previous', MAIN_STRINGS.previousCommand),
        command(options, 'command.next', MAIN_STRINGS.nextCommand),
        command(options, 'command.readOutput', MAIN_STRINGS.readCommandOutput),
        command(options, 'command.selectOutput', MAIN_STRINGS.selectCommandOutput),
        command(options, 'command.copyOutput', MAIN_STRINGS.copyCommandOutput),
        { type: 'separator' },
        command(options, 'terminal.zoomIn', MAIN_STRINGS.biggerText),
        command(options, 'terminal.zoomOut', MAIN_STRINGS.smallerText),
        command(options, 'terminal.zoomReset', MAIN_STRINGS.defaultTextSize),
    ];
}

/**
 * The terminal's context menu: Copy (with a selection), Paste, List Links, Look Up and Clear Scrollback (A11Y-11.11,
 * US-1.12, US-3.2.3).
 */
export function terminalContextMenu(
    options: Pick<MenuOptions, 'keymap' | 'onCommand' | 'onLookUp' | 'platform'>,
    canCopy: boolean,
): MenuItemConstructorOptions[] {
    const windows = options.platform === 'windows';
    const lookUp: MenuItemConstructorOptions[] = windows
        ? []
        : [{ label: MAIN_STRINGS.lookUp, enabled: canCopy, click: () => options.onLookUp() }];
    return [
        { role: 'copy', enabled: canCopy, ...(windows ? { accelerator: 'Ctrl+Shift+C' } : {}) },
        { role: 'paste', ...(windows ? { accelerator: 'Ctrl+Shift+V' } : {}) },
        { type: 'separator' },
        command(options, 'terminal.listLinks', MAIN_STRINGS.listLinks),
        ...lookUp,
        { type: 'separator' },
        command(options, 'terminal.clearScrollback', MAIN_STRINGS.clearScrollback),
    ];
}

function command(
    options: Pick<MenuOptions, 'keymap' | 'onCommand'>,
    id: CommandId,
    label: string,
): MenuItemConstructorOptions {
    const chord = options.keymap.chordFor(id);
    const accelerator = chord === undefined ? undefined : menuAccelerator(chord, options.keymap.platform);
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
            command(options, 'terminal.clearScrollback', MAIN_STRINGS.clearScrollback),
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

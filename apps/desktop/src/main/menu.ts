import type { MenuItemConstructorOptions } from 'electron';
import type { AppCommand } from '../shared/contract';
import { MAIN_STRINGS } from './strings';

/** What the menu needs. */
export interface MenuOptions {
    readonly appName: string;
    /** Sends a command to the renderer. */
    readonly onCommand: (command: AppCommand) => void;
    /** Shows the macOS Look Up panel for the focused page's selection. */
    readonly onLookUp: () => void;
}

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

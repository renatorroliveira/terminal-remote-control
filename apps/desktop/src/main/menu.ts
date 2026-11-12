import type { MenuItemConstructorOptions } from 'electron';
import type { AppCommand } from '../shared/contract';
import { MAIN_STRINGS } from './strings';

/** What the menu needs. */
export interface MenuOptions {
    readonly appName: string;
    /** Sends a command to the renderer. */
    readonly onCommand: (command: AppCommand) => void;
}

/** The menu bar: the standard macOS menus, zoom in View, and Help with the user guide and accessibility help. */
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
        { role: 'editMenu' },
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

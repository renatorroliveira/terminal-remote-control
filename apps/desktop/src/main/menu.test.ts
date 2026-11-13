import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it } from 'vitest';
import { resolveKeymap } from '../shared/keymap';
import { type MenuOptions, menuTemplate } from './menu';

function labels(items: readonly MenuItemConstructorOptions[]): (string | undefined)[] {
    return items.map((item) => item.label ?? item.role);
}

function options(): MenuOptions {
    return {
        appName: 'Terminal Remote Control',
        keymap: resolveKeymap({}),
        onCommand: () => undefined,
        onLookUp: () => undefined,
        themePreference: 'midnight',
        onThemePreference: () => undefined,
    };
}

describe('menuTemplate', () => {
    it('has the standard macOS menus, including Help', () => {
        const template = menuTemplate(options());
        expect(labels(template)).toEqual(['Terminal Remote Control', 'Edit', 'View', 'Terminal', 'windowMenu', 'help']);
    });

    it('sends the help commands to the renderer', () => {
        const commands: string[] = [];
        const template = menuTemplate({ ...options(), onCommand: (id) => commands.push(id) });
        const help = template.at(-1)?.submenu as MenuItemConstructorOptions[];
        expect(help.map((item) => [item.label, item.accelerator])).toEqual([
            ['Terminal Remote Control Help', undefined],
            ['Accessibility Help', undefined],
        ]);
        for (const item of help) {
            item.click?.(undefined as never, undefined, undefined as never);
        }
        expect(commands).toEqual(['help.userGuide', 'help.accessibility']);
    });
});

describe('menuTemplate: View', () => {
    it('offers the palette, the sidebar, regions, notifications and zoom (A11Y-05, A11Y-07.4)', () => {
        const template = menuTemplate(options());
        const view = template[2]?.submenu as MenuItemConstructorOptions[];
        expect(view.map((item) => item.role ?? item.label ?? item.type)).toEqual([
            'Command Palette…',
            'Show Notifications',
            'separator',
            'Show or Hide Sidebar',
            'Next Region',
            'Previous Region',
            'separator',
            'Theme',
            'separator',
            'resetZoom',
            'zoomIn',
            'zoomOut',
            'separator',
            'togglefullscreen',
        ]);
    });

    it('shows each Command shortcut from the keymap and sends the command to the renderer (docs/design/keymap.md)', () => {
        const commands: string[] = [];
        const template = menuTemplate({ ...options(), onCommand: (id) => commands.push(id) });
        const view = template[2]?.submenu as MenuItemConstructorOptions[];
        const terminal = template[3]?.submenu as MenuItemConstructorOptions[];
        const accelerators = [...view, ...terminal]
            .filter((item) => item.click !== undefined && item.label !== 'Theme')
            .map((item) => [item.label, item.accelerator]);
        expect(accelerators).toEqual([
            ['Command Palette…', 'Shift+Command+P'],
            ['Show Notifications', 'Shift+Command+N'],
            ['Show or Hide Sidebar', 'Control+Command+S'],
            ['Next Region', 'Command+F6'],
            ['Previous Region', 'Shift+Command+F6'],
            ['Tab Moves Focus', 'Shift+Command+M'],
            ['Send Next Key to Terminal', 'Shift+Command+K'],
            ['Mute Output Announcements', 'Shift+Command+A'],
        ]);
        for (const item of terminal) {
            item.click?.(undefined as never, undefined, undefined as never);
        }
        expect(commands).toEqual(['terminal.toggleTabFocus', 'terminal.sendNextKey', 'announcements.toggleMute']);
    });

    it('shows no shortcut for a command bound to a key the terminal may need', () => {
        const template = menuTemplate({ ...options(), keymap: resolveKeymap({ 'region.next': 'F6' }) });
        const view = template[2]?.submenu as MenuItemConstructorOptions[];
        expect(view.find((item) => item.label === 'Next Region')?.accelerator).toBeUndefined();
    });
});

describe('menuTemplate: Edit', () => {
    it('has the macOS text services in Edit: Look Up and Speech (US-1.12, A11Y-04)', () => {
        let lookedUp = 0;
        const template = menuTemplate({ ...options(), onLookUp: () => (lookedUp += 1) });
        const edit = template[1]?.submenu as MenuItemConstructorOptions[];
        expect(edit.map((item) => item.role ?? item.label ?? item.type)).toEqual([
            'undo',
            'redo',
            'separator',
            'cut',
            'copy',
            'paste',
            'selectAll',
            'separator',
            'Look Up',
            'separator',
            'Speech',
        ]);
        const lookUp = edit.find((item) => item.label === 'Look Up');
        expect(lookUp?.accelerator).toBe('Ctrl+Cmd+D');
        lookUp?.click?.(undefined as never, undefined, undefined as never);
        expect(lookedUp).toBe(1);
        const speech = edit.at(-1)?.submenu as MenuItemConstructorOptions[];
        expect(speech.map((item) => item.role)).toEqual(['startSpeaking', 'stopSpeaking']);
    });

    it('picks the theme from View, Midnight checked by default (A11Y-07.3)', () => {
        const picked: string[] = [];
        const template = menuTemplate({ ...options(), onThemePreference: (theme) => picked.push(theme) });
        const view = template[2]?.submenu as MenuItemConstructorOptions[];
        const themes = view.find((item) => item.label === 'Theme')?.submenu as MenuItemConstructorOptions[];
        expect(themes.map((item) => [item.label ?? item.type, item.type, item.checked])).toEqual([
            ['Midnight', 'radio', true],
            ['Match System', 'radio', false],
            ['separator', 'separator', undefined],
            ['Light', 'radio', false],
            ['Dark', 'radio', false],
            ['High Contrast Light', 'radio', false],
            ['High Contrast Dark', 'radio', false],
        ]);
        themes[1]?.click?.(undefined as never, undefined, undefined as never);
        themes[5]?.click?.(undefined as never, undefined, undefined as never);
        expect(picked).toEqual(['system', 'hc-light']);
    });
});

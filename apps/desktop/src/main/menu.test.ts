import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it } from 'vitest';
import { resolveKeymap } from '../shared/keymap';
import { type MenuOptions, menuTemplate, terminalContextMenu } from './menu';

function labels(items: readonly MenuItemConstructorOptions[]): (string | undefined)[] {
    return items.map((item) => item.label ?? item.role);
}

function options(): MenuOptions {
    return {
        appName: 'Terminal Remote Control',
        platform: 'mac',
        keymap: resolveKeymap({}),
        onCommand: () => undefined,
        onLookUp: () => undefined,
        themePreference: 'midnight',
        onThemePreference: () => undefined,
        onEdit: () => undefined,
        onPageZoom: () => undefined,
        onFullScreen: () => undefined,
    };
}

function windowsOptions(): MenuOptions {
    return { ...options(), platform: 'windows', keymap: resolveKeymap({}, { platform: 'windows' }) };
}

function submenu(template: readonly MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] {
    return (template.find((item) => item.label === label)?.submenu ?? []) as MenuItemConstructorOptions[];
}

describe('menuTemplate', () => {
    it('has the standard macOS menus, including Help', () => {
        const template = menuTemplate(options());
        expect(labels(template)).toEqual([
            'Terminal Remote Control',
            'Session',
            'Edit',
            'View',
            'Terminal',
            'windowMenu',
            'help',
        ]);
    });

    it('opens Settings from the app menu with Command+, (A11Y-10.3)', () => {
        const commands: string[] = [];
        const template = menuTemplate({ ...options(), onCommand: (id) => commands.push(id) });
        const app = template[0]?.submenu as MenuItemConstructorOptions[];
        const settings = app.find((item) => item.label === 'Settings…');
        expect(settings?.accelerator).toBe('Command+,');
        expect(labels(app).slice(0, 3)).toEqual(['about', undefined, 'Settings…']);
        settings?.click?.(undefined as never, undefined, undefined as never);
        expect(commands).toEqual(['settings.show']);
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
        const view = template[3]?.submenu as MenuItemConstructorOptions[];
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
        expect(
            view.filter((item) => item.role?.toLowerCase().includes('zoom')).map((item) => item.accelerator),
        ).toEqual(['Control+Command+0', 'Control+Command+=', 'Control+Command+-']);
    });
});

describe('menuTemplate: Command shortcuts', () => {
    it('shows each Command shortcut from the keymap and sends the command to the renderer (docs/design/keymap.md)', () => {
        const commands: string[] = [];
        const template = menuTemplate({ ...options(), onCommand: (id) => commands.push(id) });
        const view = template[3]?.submenu as MenuItemConstructorOptions[];
        const terminal = template[4]?.submenu as MenuItemConstructorOptions[];
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
            ['List Links…', 'Shift+Command+O'],
            ['Review Mode', undefined],
            ['Find…', 'Command+F'],
            ['Previous Command', 'Alt+Command+Up'],
            ['Next Command', 'Alt+Command+Down'],
            ['Read Last Command Output', 'Alt+Command+R'],
            ['Select Last Command Output', 'Alt+Command+A'],
            ['Copy Last Command Output', 'Alt+Command+C'],
            ['Bigger Text', 'Command+='],
            ['Smaller Text', 'Command+-'],
            ['Default Text Size', 'Command+0'],
        ]);
        for (const item of terminal) {
            item.click?.(undefined as never, undefined, undefined as never);
        }
        expect(commands).toEqual([
            'terminal.toggleTabFocus',
            'terminal.sendNextKey',
            'announcements.toggleMute',
            'terminal.listLinks',
            'review.toggle',
            'terminal.find',
            'command.previous',
            'command.next',
            'command.readOutput',
            'command.selectOutput',
            'command.copyOutput',
            'terminal.zoomIn',
            'terminal.zoomOut',
            'terminal.zoomReset',
        ]);
    });

    it('shows no shortcut for a command bound to a key the terminal may need', () => {
        const template = menuTemplate({ ...options(), keymap: resolveKeymap({ 'region.next': 'F6' }) });
        const view = template[3]?.submenu as MenuItemConstructorOptions[];
        expect(view.find((item) => item.label === 'Next Region')?.accelerator).toBeUndefined();
    });
});

describe('menuTemplate: Edit', () => {
    it('has the macOS text services in Edit: Look Up and Speech (US-1.12, A11Y-04)', () => {
        let lookedUp = 0;
        const template = menuTemplate({ ...options(), onLookUp: () => (lookedUp += 1) });
        const edit = template[2]?.submenu as MenuItemConstructorOptions[];
        expect(edit.map((item) => item.role ?? item.label ?? item.type)).toEqual([
            'undo',
            'redo',
            'separator',
            'cut',
            'copy',
            'paste',
            'selectAll',
            'separator',
            'Clear Scrollback',
            'separator',
            'Look Up',
            'separator',
            'Speech',
        ]);
        expect(edit.find((item) => item.label === 'Clear Scrollback')?.accelerator).toBe('Command+K');
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
        const view = template[3]?.submenu as MenuItemConstructorOptions[];
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

describe('menuTemplate: Session', () => {
    it('creates, switches, finds and closes sessions with their shortcuts (US-1.7.1, US-1.8.2, US-1.10.8, US-5.4)', () => {
        const template = menuTemplate(options());
        const session = template[1]?.submenu as MenuItemConstructorOptions[];
        expect(session.map((item) => [item.label ?? item.type, item.accelerator])).toEqual([
            ['New Session', 'Command+T'],
            ['New Session…', 'Shift+Command+T'],
            ['separator', undefined],
            ['Next Session', 'Shift+Command+]'],
            ['Previous Session', 'Shift+Command+['],
            ['Go to Session…', 'Command+P'],
            ['separator', undefined],
            ['Close Session…', 'Command+W'],
        ]);
    });
});

describe('the Windows menus (US-6.1.3, P-92, D-67)', () => {
    it('has File, Edit, View, Terminal and Help, each with its access key', () => {
        expect(labels(menuTemplate(windowsOptions()))).toEqual(['&File', '&Edit', '&View', '&Terminal', '&Help']);
    });

    it('puts the session commands, Settings and Exit in File, with the Windows shortcuts', () => {
        const file = submenu(menuTemplate(windowsOptions()), '&File');
        const shortcuts = file.map((item) => [item.label ?? item.role ?? item.type, item.accelerator]);
        expect(shortcuts).toContainEqual(['New Session', 'Control+Shift+T']);
        expect(shortcuts).toContainEqual(['Close Session…', 'Control+Shift+W']);
        expect(shortcuts).toContainEqual(['Settings…', 'Control+,']);
        expect(shortcuts).toContainEqual(['Next Session', undefined]);
        expect(file.at(-1)).toMatchObject({ role: 'quit', label: 'Exit' });
    });

    it('copies and pastes with Ctrl+Shift+C and Ctrl+Shift+V, and takes no Control key the shell owns (P-86)', () => {
        const edits: string[] = [];
        const edit = submenu(menuTemplate({ ...windowsOptions(), onEdit: (action) => edits.push(action) }), '&Edit');
        expect(edit.filter((item) => item.role !== undefined).map((item) => [item.role, item.accelerator])).toEqual([
            ['copy', 'Ctrl+Shift+C'],
            ['paste', 'Ctrl+Shift+V'],
        ]);
        const controlLetter = /^(Control|Ctrl)\+[A-Z0-9]$/;
        expect(edit.filter((item) => controlLetter.test(String(item.accelerator ?? '')))).toEqual([]);
        for (const item of edit.filter((entry) => entry.click !== undefined && entry.role === undefined)) {
            item.click?.(undefined as never, undefined, undefined as never);
        }
        expect(edits).toEqual(['undo', 'redo', 'cut', 'selectAll']);
    });

    it('zooms the window and goes full screen from View without taking the terminal text size keys or F11', () => {
        const zooms: string[] = [];
        const view = submenu(menuTemplate({ ...windowsOptions(), onPageZoom: (zoom) => zooms.push(zoom) }), '&View');
        const zoomItems = view.filter((item) => ['Actual Size', 'Zoom In', 'Zoom Out'].includes(item.label ?? ''));
        for (const item of zoomItems) {
            item.click?.(undefined as never, undefined, undefined as never);
        }
        expect(zooms).toEqual(['reset', 'in', 'out']);
        expect(
            [...zoomItems, ...view.filter((item) => item.label === 'Full Screen')].map((item) => item.accelerator),
        ).toEqual([undefined, undefined, undefined, undefined]);
    });

    it('ends with About in Help, and offers no Look Up in the context menu', () => {
        expect(submenu(menuTemplate(windowsOptions()), '&Help').at(-1)).toMatchObject({ role: 'about' });
        const context = terminalContextMenu(windowsOptions(), true);
        expect(context.map((item) => item.role ?? item.label ?? item.type)).not.toContain('Look Up');
        expect(context[0]).toMatchObject({ role: 'copy', accelerator: 'Ctrl+Shift+C' });
    });
});

describe('terminalContextMenu (A11Y-11.11, US-1.12)', () => {
    it('offers Copy only with a selection, Paste, List Links, Look Up and Clear Scrollback', () => {
        const commands: string[] = [];
        const lookUps: number[] = [];
        const menu = terminalContextMenu(
            { ...options(), onCommand: (id) => commands.push(id), onLookUp: () => lookUps.push(1) },
            false,
        );
        expect(menu.map((item) => item.role ?? item.label ?? item.type)).toEqual([
            'copy',
            'paste',
            'separator',
            'List Links…',
            'Look Up',
            'separator',
            'Clear Scrollback',
        ]);
        expect(menu[0]?.enabled).toBe(false);
        expect(menu[4]?.enabled).toBe(false);
        expect(terminalContextMenu(options(), true)[0]?.enabled).toBe(true);
        menu[3]?.click?.(undefined as never, undefined, undefined as never);
        menu[6]?.click?.(undefined as never, undefined, undefined as never);
        expect(commands).toEqual(['terminal.listLinks', 'terminal.clearScrollback']);
    });
});

import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it } from 'vitest';
import { type MenuOptions, menuTemplate } from './menu';

function labels(items: readonly MenuItemConstructorOptions[]): (string | undefined)[] {
    return items.map((item) => item.label ?? item.role);
}

function options(): MenuOptions {
    return { appName: 'Term Remote Control', onCommand: () => undefined, onLookUp: () => undefined };
}

describe('menuTemplate', () => {
    it('has the standard macOS menus, including Help', () => {
        const template = menuTemplate(options());
        expect(labels(template)).toEqual(['Term Remote Control', 'Edit', 'View', 'windowMenu', 'help']);
    });

    it('sends the help commands to the renderer', () => {
        const commands: string[] = [];
        const template = menuTemplate({ ...options(), onCommand: (id) => commands.push(id) });
        const help = template.at(-1)?.submenu as MenuItemConstructorOptions[];
        expect(help.map((item) => [item.label, item.accelerator])).toEqual([
            ['Term Remote Control Help', undefined],
            ['Accessibility Help', 'Alt+F1'],
        ]);
        for (const item of help) {
            item.click?.(undefined as never, undefined, undefined as never);
        }
        expect(commands).toEqual(['help.userGuide', 'help.accessibility']);
    });

    it('offers zoom from the View menu (A11Y-07.4)', () => {
        const template = menuTemplate(options());
        const view = template[2]?.submenu as MenuItemConstructorOptions[];
        expect(view.map((item) => item.role ?? item.type)).toEqual([
            'resetZoom',
            'zoomIn',
            'zoomOut',
            'separator',
            'togglefullscreen',
        ]);
    });

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
});

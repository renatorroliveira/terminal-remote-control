import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it } from 'vitest';
import { menuTemplate } from './menu';

function labels(items: readonly MenuItemConstructorOptions[]): (string | undefined)[] {
    return items.map((item) => item.label ?? item.role);
}

describe('menuTemplate', () => {
    it('has the standard macOS menus, including Help', () => {
        const template = menuTemplate({ appName: 'Term Remote Control', onCommand: () => undefined });
        expect(labels(template)).toEqual(['Term Remote Control', 'editMenu', 'View', 'windowMenu', 'help']);
    });

    it('sends the help commands to the renderer', () => {
        const commands: string[] = [];
        const template = menuTemplate({ appName: 'Term Remote Control', onCommand: (id) => commands.push(id) });
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
        const template = menuTemplate({ appName: 'Term Remote Control', onCommand: () => undefined });
        const view = template[2]?.submenu as MenuItemConstructorOptions[];
        expect(view.map((item) => item.role ?? item.type)).toEqual([
            'resetZoom',
            'zoomIn',
            'zoomOut',
            'separator',
            'togglefullscreen',
        ]);
    });
});

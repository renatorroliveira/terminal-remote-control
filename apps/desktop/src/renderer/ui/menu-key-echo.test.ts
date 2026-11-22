import { describe, expect, it } from 'vitest';
import { menuKeyEcho, opensContextMenu } from './menu-key-echo';

describe('menuKeyEcho: the Menu key opens one context menu on Windows (A11Y-11.11)', () => {
    it('ignores the contextmenu event that repeats a Menu key press, once', () => {
        const echo = menuKeyEcho();
        echo.pressed({ key: 'ContextMenu' });
        expect(echo.echoes({ button: -1 })).toBe(true);
        expect(echo.echoes({ button: -1 })).toBe(false);
    });

    it('keeps a secondary click, a keyless contextmenu, and one after another key', () => {
        const echo = menuKeyEcho();
        expect(echo.echoes({ button: -1 })).toBe(false);
        echo.pressed({ key: 'ContextMenu' });
        expect(echo.echoes({ button: 2 })).toBe(false);
        echo.pressed({ key: 'ContextMenu' });
        echo.pressed({ key: 'Escape' });
        expect(echo.echoes({ button: -1 })).toBe(false);
    });

    it('opens a menu on Shift+F10 and the Menu key only', () => {
        expect(opensContextMenu({ key: 'ContextMenu', shiftKey: false })).toBe(true);
        expect(opensContextMenu({ key: 'F10', shiftKey: true })).toBe(true);
        expect(opensContextMenu({ key: 'F10', shiftKey: false })).toBe(false);
    });
});

import { describe, expect, it, onTestFinished } from 'vitest';
import { type CommandId, resolveKeymap } from '../../shared/keymap';
import { CommandRegistry } from './command-registry';
import { installShortcuts } from './shortcuts';

function press(target: EventTarget, code: string, modifiers: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...modifiers });
    target.dispatchEvent(event);
    return event;
}

function setup(state: { passNextKey?: boolean; blocked?: boolean } = {}) {
    const ran: CommandId[] = [];
    const commands = new CommandRegistry();
    commands.register({ id: 'palette.show', label: 'Show command palette', run: () => ran.push('palette.show') });
    const input = document.createElement('textarea');
    document.body.append(input);
    const uninstall = installShortcuts(window, {
        keymap: resolveKeymap({}),
        commands,
        passNextKey: () => state.passNextKey ?? false,
        blocked: () => state.blocked ?? false,
    });
    onTestFinished(() => {
        uninstall();
        input.remove();
    });
    return { ran, input };
}

describe('installShortcuts: one dispatcher for every app shortcut (A11Y-05.2, A11Y-05.3)', () => {
    it('runs the bound command before the focused element sees the key', () => {
        const { ran, input } = setup();
        let reached = false;
        input.addEventListener('keydown', () => {
            reached = true;
        });
        const event = press(input, 'KeyP', { metaKey: true, shiftKey: true });
        expect(ran).toEqual(['palette.show']);
        expect(event.defaultPrevented).toBe(true);
        expect(reached).toBe(false);
    });

    it('leaves other keys, and commands nobody registered, to the focused element', () => {
        const { ran, input } = setup();
        expect(press(input, 'KeyP', { ctrlKey: true }).defaultPrevented).toBe(false);
        expect(press(input, 'F6', { metaKey: true }).defaultPrevented).toBe(false);
        expect(ran).toEqual([]);
    });

    it('passes the next key to the terminal, and holds back while a modal dialog is open', () => {
        const passing = setup({ passNextKey: true });
        expect(press(passing.input, 'KeyP', { metaKey: true, shiftKey: true }).defaultPrevented).toBe(false);
        expect(passing.ran).toEqual([]);
        const blocked = setup({ blocked: true });
        expect(press(blocked.input, 'KeyP', { metaKey: true, shiftKey: true }).defaultPrevented).toBe(false);
        expect(blocked.ran).toEqual([]);
    });
});

describe('CommandRegistry', () => {
    it('runs registered commands by ID and lists them for the palette in registration order', () => {
        const commands = new CommandRegistry();
        const ran: string[] = [];
        commands.register({ id: 'region.next', label: 'Next region', run: () => ran.push('next') });
        commands.register({ id: 'region.previous', label: 'Previous region', run: () => ran.push('previous') });
        expect(commands.run('region.previous')).toBe(true);
        expect(commands.run('palette.show')).toBe(false);
        expect(ran).toEqual(['previous']);
        expect(commands.list().map((command) => command.label)).toEqual(['Next region', 'Previous region']);
    });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    bindingProblem,
    chordFromKey,
    DEFAULT_KEYMAP,
    formatChord,
    type KeyInput,
    menuAccelerator,
    parseChord,
    resolveKeymap,
} from './keymap';

function key(code: string, modifiers: Partial<KeyInput> = {}): KeyInput {
    return { code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers };
}

function chord(text: string) {
    const parsed = parseChord(text);
    if (parsed === undefined) {
        throw new Error(`not a chord: ${text}`);
    }
    return parsed;
}

describe('keymap chords', () => {
    it('parses any modifier order and spelling, and formats in the macOS order', () => {
        expect(formatChord(chord('cmd+shift+p'))).toBe('Shift+Cmd+P');
        expect(formatChord(chord('Command+Control+S'))).toBe('Ctrl+Cmd+S');
        expect(formatChord(chord('Alt+F1'))).toBe('Option+F1');
        expect(parseChord('Cmd+')).toBeUndefined();
        expect(parseChord('Hyper+P')).toBeUndefined();
        expect(parseChord('Cmd+Shift+Banana')).toBeUndefined();
    });

    it('reads a key press by its physical key, so Option and Shift never change the letter', () => {
        expect(formatChord(chordFromKey(key('KeyP', { metaKey: true, shiftKey: true })) ?? chord('F1'))).toBe(
            'Shift+Cmd+P',
        );
        expect(formatChord(chordFromKey(key('F6', { metaKey: true })) ?? chord('F1'))).toBe('Cmd+F6');
        expect(formatChord(chordFromKey(key('BracketLeft', { ctrlKey: true })) ?? chord('F1'))).toBe('Ctrl+[');
        expect(chordFromKey(key('ShiftLeft', { shiftKey: true }))).toBeUndefined();
    });

    it('shows a menu shortcut only for Command chords, which never reach the terminal', () => {
        expect(menuAccelerator(chord('Shift+Cmd+P'))).toBe('Shift+Command+P');
        expect(menuAccelerator(chord('Ctrl+Cmd+S'))).toBe('Control+Command+S');
        expect(menuAccelerator(chord('Option+F1'))).toBeUndefined();
        expect(menuAccelerator(chord('F6'))).toBeUndefined();
    });
});

describe('bindingProblem: the A11Y-05.5 and A11Y-05.6 rules', () => {
    it('needs Control, Option or Command, or a function key', () => {
        expect(bindingProblem(chord('Shift+P'))).toBe('no-modifier');
        expect(bindingProblem(chord('F6'))).toBeUndefined();
        expect(bindingProblem(chord('Shift+F6'))).toBeUndefined();
    });

    it('leaves control codes, Option typing and VoiceOver to their owners', () => {
        expect(bindingProblem(chord('Ctrl+M'))).toBe('control-code');
        expect(bindingProblem(chord('Ctrl+['))).toBe('control-code');
        expect(bindingProblem(chord('Ctrl+Shift+Space'))).toBe('control-code');
        expect(bindingProblem(chord('Option+E'))).toBe('option-types');
        expect(bindingProblem(chord('Option+Left'))).toBe('option-types');
        expect(bindingProblem(chord('Ctrl+Option+Right'))).toBe('screen-reader');
    });

    it('refuses chords macOS or the app menus already own', () => {
        expect(bindingProblem(chord('Cmd+Tab'))).toBe('reserved');
        expect(bindingProblem(chord('Cmd+F5'))).toBe('reserved');
        expect(bindingProblem(chord('Ctrl+F6'))).toBe('reserved');
        expect(bindingProblem(chord('Cmd+C'))).toBe('reserved');
        expect(bindingProblem(chord('Ctrl+Cmd+F'))).toBe('reserved');
        expect(bindingProblem(chord('Shift+Cmd+4'))).toBe('reserved');
        expect(bindingProblem(chord('Ctrl+Cmd+='))).toBe('reserved');
        expect(bindingProblem(chord('Option+Cmd+='))).toBe('reserved');
    });

    it('leaves Command+=, Command+- and Command+0 to the terminal text size (A11Y-07.4)', () => {
        expect(bindingProblem(chord('Cmd+='))).toBeUndefined();
        expect(resolveKeymap({}).chordFor('terminal.zoomIn')).toEqual(chord('Cmd+='));
        expect(resolveKeymap({}).chordFor('terminal.zoomOut')).toEqual(chord('Cmd+-'));
        expect(resolveKeymap({}).chordFor('terminal.zoomReset')).toEqual(chord('Cmd+0'));
    });
});

describe('resolveKeymap: defaults plus the user’s bindings', () => {
    it('gives every default its chord, and the defaults break no rule', () => {
        const keymap = resolveKeymap({});
        expect(keymap.refused).toEqual([]);
        expect(keymap.commandFor(chord('Cmd+F6'))).toBe('region.next');
        expect(keymap.chordFor('palette.show')).toEqual(chord('Shift+Cmd+P'));
        expect(keymap.chordFor('help.userGuide')).toBeUndefined();
    });

    it('applies a valid rebinding and refuses a broken or duplicate one, keeping the default', () => {
        const keymap = resolveKeymap({
            'region.next': 'F6',
            'palette.show': 'Ctrl+P',
            'sidebar.toggle': 'Shift+Cmd+M',
            'help.userGuide': 'nonsense',
        });
        expect(keymap.commandFor(chord('F6'))).toBe('region.next');
        expect(keymap.commandFor(chord('Cmd+F6'))).toBeUndefined();
        expect(keymap.chordFor('palette.show')).toEqual(chord('Shift+Cmd+P'));
        expect(keymap.chordFor('sidebar.toggle')).toEqual(chord('Ctrl+Cmd+S'));
        expect(keymap.refused).toEqual([
            { command: 'palette.show', binding: 'Ctrl+P', problem: 'control-code' },
            { command: 'sidebar.toggle', binding: 'Shift+Cmd+M', problem: 'duplicate' },
            { command: 'help.userGuide', binding: 'nonsense', problem: 'unreadable' },
        ]);
    });

    it('adds plain F6 and Shift+F6 for the regions when asked, unless a command took them (A11Y-05.2)', () => {
        const plain = resolveKeymap({}, { plainF6: true });
        expect(plain.commandFor(chord('F6'))).toBe('region.next');
        expect(plain.commandFor(chord('Shift+F6'))).toBe('region.previous');
        expect(plain.chordFor('region.next')).toEqual(chord('Cmd+F6'));
        expect(resolveKeymap({}).commandFor(chord('F6'))).toBeUndefined();
        const taken = resolveKeymap({ 'review.toggle': 'F6' }, { plainF6: true });
        expect(taken.commandFor(chord('F6'))).toBe('review.toggle');
        expect(taken.commandFor(chord('Shift+F6'))).toBe('region.previous');
    });

    it('matches the defaults docs/design/keymap.md documents', () => {
        const design = readFileSync(join(import.meta.dirname, '../../../../docs/design/keymap.md'), 'utf8');
        for (const binding of Object.values(DEFAULT_KEYMAP)) {
            const words = formatChord(chord(binding)).replace('Ctrl', 'Control').replace('Cmd', 'Command').split('+');
            const documented = [words.slice(0, -1).sort(), words.at(-1)];
            const rows = [...design.matchAll(/\| ([A-Za-z+0-9[\]=,-]+) +\|/g)].map((match) => {
                const parts = (match[1] ?? '').split('+');
                return [parts.slice(0, -1).sort(), parts.at(-1)];
            });
            expect(rows).toContainEqual(documented);
        }
    });
});

/** Every command a shortcut, a menu item or the command palette can run (docs/design/keymap.md). */
export const COMMAND_IDS = [
    'region.next',
    'region.previous',
    'palette.show',
    'sidebar.toggle',
    'terminal.toggleTabFocus',
    'terminal.sendNextKey',
    'announcements.toggleMute',
    'notifications.show',
    'help.accessibility',
    'help.userGuide',
] as const;

/** A command's ID. */
export type CommandId = (typeof COMMAND_IDS)[number];

/** A key with its modifiers, Control, Option, Shift and Command. */
export interface Chord {
    readonly ctrl: boolean;
    readonly option: boolean;
    readonly shift: boolean;
    readonly cmd: boolean;
    /** The physical key: a letter, digit, punctuation mark, `F1`…`F24` or a named key such as `Left`. */
    readonly key: string;
}

/** The parts of a key press a chord needs, as a `KeyboardEvent` has them. */
export interface KeyInput {
    readonly code: string;
    readonly ctrlKey: boolean;
    readonly altKey: boolean;
    readonly shiftKey: boolean;
    readonly metaKey: boolean;
}

/** Why a binding cannot be used (A11Y-05.5, A11Y-05.6). */
export type BindingProblem = 'no-modifier' | 'control-code' | 'option-types' | 'screen-reader' | 'reserved';

/** A binding the user asked for that the keymap refused, so the command kept its default. */
export interface RefusedBinding {
    readonly command: CommandId;
    readonly binding: string;
    readonly problem: BindingProblem | 'duplicate' | 'unreadable';
}

/** The shortcuts in force: which command a chord runs, and which chord runs a command. */
export interface Keymap {
    commandFor(chord: Chord): CommandId | undefined;
    chordFor(command: CommandId): Chord | undefined;
    readonly refused: readonly RefusedBinding[];
}

/** The default shortcuts on macOS (docs/design/keymap.md). Commands without one run from menus and the palette. */
export const DEFAULT_KEYMAP: Readonly<Partial<Record<CommandId, string>>> = {
    'region.next': 'Cmd+F6',
    'region.previous': 'Shift+Cmd+F6',
    'palette.show': 'Shift+Cmd+P',
    'sidebar.toggle': 'Ctrl+Cmd+S',
    'terminal.toggleTabFocus': 'Shift+Cmd+M',
    'terminal.sendNextKey': 'Shift+Cmd+K',
    'announcements.toggleMute': 'Shift+Cmd+A',
    'notifications.show': 'Shift+Cmd+N',
    'help.accessibility': 'Option+F1',
};

/** Reads a chord such as `Shift+Cmd+P`; modifiers come in any order, as `Ctrl`, `Control`, `Option`, `Alt`, `Cmd`. */
export function parseChord(text: string): Chord | undefined {
    const parts = text.split('+').map((part) => part.trim());
    const key = normalizedKey(parts.at(-1) ?? '');
    const modifiers = parts.slice(0, -1).map((part) => MODIFIER_NAMES[part.toLowerCase()]);
    if (key === undefined || modifiers.some((modifier) => modifier === undefined)) {
        return undefined;
    }
    return {
        ctrl: modifiers.includes('ctrl'),
        option: modifiers.includes('option'),
        shift: modifiers.includes('shift'),
        cmd: modifiers.includes('cmd'),
        key,
    };
}

/** A chord as text, modifiers in the macOS order: `Ctrl+Option+Shift+Cmd+Key`. */
export function formatChord(chord: Chord): string {
    const modifiers = MODIFIER_ORDER.filter((modifier) => chord[modifier]).map((modifier) => MODIFIER_LABELS[modifier]);
    return [...modifiers, chord.key].join('+');
}

/** The chord a key press makes, by physical key; a modifier key alone makes none. */
export function chordFromKey(input: KeyInput): Chord | undefined {
    const key = keyFromCode(input.code);
    if (key === undefined) {
        return undefined;
    }
    return { ctrl: input.ctrlKey, option: input.altKey, shift: input.shiftKey, cmd: input.metaKey, key };
}

/**
 * The Electron accelerator a menu item shows for a chord, only when it holds Command: Command chords never reach the
 * terminal, so the menu can take them, while any other chord stays with the renderer and "send next key".
 */
export function menuAccelerator(chord: Chord): string | undefined {
    if (!chord.cmd) {
        return undefined;
    }
    const modifiers = MODIFIER_ORDER.filter((modifier) => chord[modifier]).map(
        (modifier) => ACCELERATOR_MODIFIERS[modifier],
    );
    return [...modifiers, chord.key].join('+');
}

/** Why a chord cannot be a shortcut, or nothing when it can (docs/design/keymap.md, rules 2 to 4). */
export function bindingProblem(chord: Chord): BindingProblem | undefined {
    const functionKey = FUNCTION_KEY.test(chord.key);
    if (!chord.ctrl && !chord.option && !chord.cmd && !functionKey) {
        return 'no-modifier';
    }
    if (chord.ctrl && chord.option) {
        return 'screen-reader';
    }
    if (chord.ctrl && !chord.cmd && CONTROL_CODE_KEYS.test(chord.key)) {
        return 'control-code';
    }
    if (chord.option && !chord.ctrl && !chord.cmd && !functionKey) {
        return 'option-types';
    }
    return RESERVED.has(formatChord(chord)) ? 'reserved' : undefined;
}

/**
 * The shortcuts in force: the defaults, with each of the user's bindings applied unless it is unreadable, breaks a
 * rule or repeats another command's chord, in which case the command keeps its default and the refusal is listed.
 */
export function resolveKeymap(overrides: Readonly<Partial<Record<CommandId, string>>>): Keymap {
    const choices = COMMAND_IDS.map((command) => choose(command, overrides[command]));
    const refused = choices.flatMap((choice) => choice.refused ?? []);
    const chosen = withoutDuplicates(choices, (command, chord) =>
        refused.push({ command, binding: overrides[command] ?? formatChord(chord), problem: 'duplicate' }),
    );
    const order = (command: CommandId): number => COMMAND_IDS.indexOf(command);
    return keymapOf(
        chosen,
        refused.sort((a, b) => order(a.command) - order(b.command)),
    );
}

type Modifier = 'ctrl' | 'option' | 'shift' | 'cmd';

const MODIFIER_ORDER: readonly Modifier[] = ['ctrl', 'option', 'shift', 'cmd'];
const MODIFIER_LABELS: Readonly<Record<Modifier, string>> = {
    ctrl: 'Ctrl',
    option: 'Option',
    shift: 'Shift',
    cmd: 'Cmd',
};
const ACCELERATOR_MODIFIERS: Readonly<Record<Modifier, string>> = {
    ctrl: 'Control',
    option: 'Alt',
    shift: 'Shift',
    cmd: 'Command',
};
const MODIFIER_NAMES: Readonly<Record<string, Modifier | undefined>> = {
    ctrl: 'ctrl',
    control: 'ctrl',
    option: 'option',
    alt: 'option',
    shift: 'shift',
    cmd: 'cmd',
    command: 'cmd',
    meta: 'cmd',
};
const NAMED_KEYS = [
    'Up',
    'Down',
    'Left',
    'Right',
    'Home',
    'End',
    'PageUp',
    'PageDown',
    'Enter',
    'Tab',
    'Space',
    'Escape',
    'Backspace',
    'Delete',
    'Menu',
] as const;
const CODE_KEYS: Readonly<Record<string, string>> = {
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Slash: '/',
    Comma: ',',
    Period: '.',
    Semicolon: ';',
    Quote: "'",
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ContextMenu: 'Menu',
};
const FUNCTION_KEY = /^F([1-9]|1[0-9]|2[0-4])$/;
const CONTROL_CODE_KEYS = /^([A-Z0-9[\]\\/]|Space)$/;
const RESERVED: ReadonlySet<string> = new Set([
    'Cmd+Tab',
    'Shift+Cmd+Tab',
    'Cmd+Space',
    'Ctrl+Space',
    'Cmd+`',
    'Cmd+F5',
    'Option+Cmd+F5',
    ...['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8'].map((key) => `Ctrl+${key}`),
    'Shift+Cmd+3',
    'Shift+Cmd+4',
    'Shift+Cmd+5',
    'Ctrl+Cmd+Q',
    'Option+Cmd+D',
    'Option+Cmd+8',
    'Option+Cmd+=',
    'Option+Cmd+-',
    ...['Z', 'X', 'C', 'V', 'A', 'H', 'M', 'Q', '0', '=', '-'].map((key) => `Cmd+${key}`),
    'Shift+Cmd+Z',
    'Option+Cmd+H',
    'Ctrl+Cmd+F',
    'Ctrl+Cmd+D',
]);

function normalizedKey(text: string): string | undefined {
    if (/^[a-z0-9]$/i.test(text)) {
        return text.toUpperCase();
    }
    if (FUNCTION_KEY.test(text.toUpperCase())) {
        return text.toUpperCase();
    }
    const named = NAMED_KEYS.find((name) => name.toLowerCase() === text.toLowerCase());
    if (named !== undefined) {
        return named;
    }
    return Object.values(CODE_KEYS).includes(text) && text.length === 1 ? text : undefined;
}

function keyFromCode(code: string): string | undefined {
    const letter = /^Key([A-Z])$/.exec(code)?.[1];
    const digit = /^Digit([0-9])$/.exec(code)?.[1];
    if (letter !== undefined || digit !== undefined) {
        return letter ?? digit;
    }
    if (FUNCTION_KEY.test(code)) {
        return code;
    }
    return CODE_KEYS[code] ?? NAMED_KEYS.find((name) => name === code);
}

function defaultChord(command: CommandId): Chord | undefined {
    const text = DEFAULT_KEYMAP[command];
    return text === undefined ? undefined : parseChord(text);
}

interface Choice {
    readonly command: CommandId;
    readonly chord: Chord | undefined;
    /** Whether the chord is the user's, not the default. */
    readonly rebound: boolean;
    readonly refused?: RefusedBinding;
}

function choose(command: CommandId, binding: string | undefined): Choice {
    const checked = binding === undefined ? undefined : checkBinding(command, binding);
    if (checked === undefined) {
        return { command, chord: defaultChord(command), rebound: false };
    }
    return 'problem' in checked
        ? { command, chord: defaultChord(command), rebound: false, refused: checked }
        : { command, chord: checked, rebound: true };
}

function checkBinding(command: CommandId, binding: string): Chord | RefusedBinding {
    const chord = parseChord(binding);
    if (chord === undefined) {
        return { command, binding, problem: 'unreadable' };
    }
    const problem = bindingProblem(chord);
    return problem === undefined ? chord : { command, binding, problem };
}

function withoutDuplicates(
    choices: readonly Choice[],
    onDuplicate: (command: CommandId, chord: Chord) => void,
): ReadonlyMap<CommandId, Chord> {
    const owners = new Set<string>();
    const chosen = new Map<CommandId, Chord>();
    const claim = (command: CommandId, chord: Chord | undefined): void => {
        if (chord !== undefined && !owners.has(formatChord(chord))) {
            owners.add(formatChord(chord));
            chosen.set(command, chord);
        }
    };
    const defaultsFirst = [...choices].sort((a, b) => Number(a.rebound) - Number(b.rebound));
    for (const { command, chord } of defaultsFirst) {
        if (chord === undefined || !owners.has(formatChord(chord))) {
            claim(command, chord);
            continue;
        }
        onDuplicate(command, chord);
        claim(command, defaultChord(command));
    }
    return chosen;
}

function keymapOf(chosen: ReadonlyMap<CommandId, Chord>, refused: readonly RefusedBinding[]): Keymap {
    const byChord = new Map([...chosen].map(([command, chord]) => [formatChord(chord), command] as const));
    return {
        commandFor: (chord) => byChord.get(formatChord(chord)),
        chordFor: (command) => chosen.get(command),
        refused,
    };
}

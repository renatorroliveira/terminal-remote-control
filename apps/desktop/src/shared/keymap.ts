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
    'session.new',
    'session.newWithOptions',
    'session.next',
    'session.previous',
    'session.close',
    'session.quickSwitch',
    'terminal.listLinks',
    'terminal.zoomIn',
    'terminal.zoomOut',
    'terminal.zoomReset',
    'review.toggle',
    'terminal.find',
    'terminal.clearScrollback',
    'command.previous',
    'command.next',
    'command.readOutput',
    'command.selectOutput',
    'command.copyOutput',
    'settings.show',
    'app.quitAndStopAll',
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

/**
 * Why a binding cannot be used (A11Y-05.5, A11Y-05.6). `control-alt` is Windows': Control with Alt types characters
 * (AltGr) on many layouts and is Magnifier's modifier.
 */
export type BindingProblem =
    'no-modifier' | 'control-code' | 'option-types' | 'screen-reader' | 'control-alt' | 'reserved';

/** Whose shortcut conventions the keymap follows: macOS's, or Windows' (E6, D-67). */
export type KeymapPlatform = 'mac' | 'windows';

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
    /** Whose conventions the shortcuts follow, which also names their keys. */
    readonly platform: KeymapPlatform;
}

/** A keymap that binds nothing, for menus that must leave every key to the page for a while. */
export const UNBOUND_KEYMAP: Keymap = {
    commandFor: () => undefined,
    chordFor: () => undefined,
    refused: [],
    platform: 'mac',
};

/** The keymap platform of a Node or Electron `process.platform` value; Linux follows Windows' rules until E7. */
export function keymapPlatformOf(platform: string): KeymapPlatform {
    return platform === 'darwin' ? 'mac' : 'windows';
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
    'session.new': 'Cmd+T',
    'session.newWithOptions': 'Shift+Cmd+T',
    'session.next': 'Shift+Cmd+]',
    'session.previous': 'Shift+Cmd+[',
    'session.close': 'Cmd+W',
    'session.quickSwitch': 'Cmd+P',
    'terminal.listLinks': 'Shift+Cmd+O',
    'terminal.zoomIn': 'Cmd+=',
    'terminal.zoomOut': 'Cmd+-',
    'terminal.zoomReset': 'Cmd+0',
    'review.toggle': 'Option+F2',
    'terminal.find': 'Cmd+F',
    'terminal.clearScrollback': 'Cmd+K',
    'command.previous': 'Option+Cmd+Up',
    'command.next': 'Option+Cmd+Down',
    'command.readOutput': 'Option+Cmd+R',
    'command.selectOutput': 'Option+Cmd+A',
    'command.copyOutput': 'Option+Cmd+C',
    'settings.show': 'Cmd+,',
};

/**
 * The default shortcuts on Windows (docs/design/keymap.md, D-67): Control+Shift where macOS has Command, as Windows
 * Terminal binds its commands, Windows' own Control+Tab, Control+F6 and Control+, conventions, Alt+F1 and Alt+F2 as
 * the PRD proposed, and never Control with a letter alone, Control with Alt, or the Windows key.
 */
export const WINDOWS_KEYMAP: Readonly<Partial<Record<CommandId, string>>> = {
    'region.next': 'Ctrl+F6',
    'region.previous': 'Ctrl+Shift+F6',
    'palette.show': 'Ctrl+Shift+P',
    'sidebar.toggle': 'Ctrl+Shift+S',
    'terminal.toggleTabFocus': 'Ctrl+Shift+M',
    'terminal.sendNextKey': 'Ctrl+Shift+K',
    'announcements.toggleMute': 'Ctrl+Shift+A',
    'notifications.show': 'Ctrl+Shift+N',
    'help.accessibility': 'Alt+F1',
    'session.new': 'Ctrl+Shift+T',
    'session.newWithOptions': 'Ctrl+Shift+Space',
    'session.next': 'Ctrl+Tab',
    'session.previous': 'Ctrl+Shift+Tab',
    'session.close': 'Ctrl+Shift+W',
    'session.quickSwitch': 'Ctrl+Shift+G',
    'terminal.listLinks': 'Ctrl+Shift+O',
    'terminal.zoomIn': 'Ctrl+=',
    'terminal.zoomOut': 'Ctrl+-',
    'terminal.zoomReset': 'Ctrl+Shift+0',
    'review.toggle': 'Alt+F2',
    'terminal.find': 'Ctrl+Shift+F',
    'terminal.clearScrollback': 'Ctrl+Shift+L',
    'command.previous': 'Ctrl+Up',
    'command.next': 'Ctrl+Down',
    'command.readOutput': 'Ctrl+Shift+R',
    'command.selectOutput': 'Ctrl+Shift+Up',
    'command.copyOutput': 'Ctrl+Shift+Y',
    'settings.show': 'Ctrl+,',
};

/** The default shortcuts on `platform`. */
export function defaultKeymap(platform: KeymapPlatform): Readonly<Partial<Record<CommandId, string>>> {
    return platform === 'windows' ? WINDOWS_KEYMAP : DEFAULT_KEYMAP;
}

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

/** A chord as text, modifiers in the macOS order: `Ctrl+Option+Shift+Cmd+Key`. Settings store chords this way. */
export function formatChord(chord: Chord): string {
    const modifiers = MODIFIER_ORDER.filter((modifier) => chord[modifier]).map((modifier) => MODIFIER_LABELS[modifier]);
    return [...modifiers, chord.key].join('+');
}

/** A chord as `platform` names its keys: as {@link formatChord} on macOS, and `Ctrl+Alt+Shift+Key` on Windows. */
export function displayChord(chord: Chord, platform: KeymapPlatform): string {
    if (platform === 'mac') {
        return formatChord(chord);
    }
    const modifiers = MODIFIER_ORDER.filter((modifier) => chord[modifier]).map(
        (modifier) => WINDOWS_MODIFIER_LABELS[modifier],
    );
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
 * The Electron accelerator a menu item shows for a chord, only for a chord the terminal never gets: on macOS one with
 * Command, and on Windows one with Control and a printable key but no Alt, which the key encoder leaves alone, while
 * named and function keys stay with the renderer and "send next key" (docs/design/keymap.md, rule 7).
 */
export function menuAccelerator(chord: Chord, platform: KeymapPlatform = 'mac'): string | undefined {
    const shown =
        platform === 'mac' ? chord.cmd : chord.ctrl && !chord.option && !chord.cmd && PRINTABLE_KEY.test(chord.key);
    if (!shown) {
        return undefined;
    }
    const modifiers = MODIFIER_ORDER.filter((modifier) => chord[modifier]).map(
        (modifier) => ACCELERATOR_MODIFIERS[modifier],
    );
    return [...modifiers, chord.key].join('+');
}

/** Why a chord cannot be a shortcut on `platform`, or nothing when it can (docs/design/keymap.md, rules 2 to 4). */
export function bindingProblem(chord: Chord, platform: KeymapPlatform = 'mac'): BindingProblem | undefined {
    return platform === 'windows' ? windowsBindingProblem(chord) : macBindingProblem(chord);
}

function macBindingProblem(chord: Chord): BindingProblem | undefined {
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
 * Windows' rules: a modifier or a function key; never the Windows key; never Control with Alt; Control with a letter,
 * digit, bracket, backslash, slash or Space alone, and Control+Shift with 2, 6 or minus (`@`, `^`, `_`), are the
 * shell's control codes; Alt with a printable key is the shell's Meta and the menus' access key; and the reserved keys.
 */
function windowsBindingProblem(chord: Chord): BindingProblem | undefined {
    if (chord.cmd) {
        return 'reserved';
    }
    if (!chord.ctrl && !chord.option && !FUNCTION_KEY.test(chord.key)) {
        return 'no-modifier';
    }
    if (chord.ctrl && chord.option) {
        return 'control-alt';
    }
    return windowsKeyProblem(chord) ?? (WINDOWS_RESERVED.has(formatChord(chord)) ? 'reserved' : undefined);
}

/** Whether Ctrl or Alt with this key is the shell's: a control code, or Meta with a printable key. */
function windowsKeyProblem(chord: Chord): BindingProblem | undefined {
    if (chord.ctrl && (chord.shift ? SHIFTED_CONTROL_CODE_KEYS : CONTROL_CODE_KEYS).test(chord.key)) {
        return 'control-code';
    }
    const printable = !FUNCTION_KEY.test(chord.key) && !NAMED_KEYS.some((name) => name === chord.key);
    return chord.option && printable ? 'option-types' : undefined;
}

/** How the keymap is built beyond the user's bindings. */
export interface KeymapOptions {
    /** Whether plain F6 and Shift+F6 also move between regions, as on Windows (A11Y-05.2). */
    readonly plainF6?: boolean;
    /** Whose defaults and rules apply; macOS's unless set. */
    readonly platform?: KeymapPlatform;
}

/**
 * The shortcuts in force: the defaults, with each of the user's bindings applied unless it is unreadable, breaks a
 * rule or repeats another command's chord, in which case the command keeps its default and the refusal is listed.
 * With `plainF6`, F6 and Shift+F6 also move between regions unless a command already took them.
 */
export function resolveKeymap(
    overrides: Readonly<Partial<Record<CommandId, string>>>,
    options: KeymapOptions = {},
): Keymap {
    const platform = options.platform ?? 'mac';
    const choices = COMMAND_IDS.map((command) => choose(command, overrides[command], platform));
    const refused = choices.flatMap((choice) => choice.refused ?? []);
    const chosen = withoutDuplicates(
        choices,
        (command, chord) =>
            refused.push({ command, binding: overrides[command] ?? formatChord(chord), problem: 'duplicate' }),
        platform,
    );
    const order = (command: CommandId): number => COMMAND_IDS.indexOf(command);
    return keymapOf(
        chosen,
        refused.sort((a, b) => order(a.command) - order(b.command)),
        options.plainF6 === true ? PLAIN_F6 : [],
        platform,
    );
}

type Modifier = 'ctrl' | 'option' | 'shift' | 'cmd';

const PLAIN_F6: readonly (readonly [string, CommandId])[] = [
    ['F6', 'region.next'],
    ['Shift+F6', 'region.previous'],
];

const MODIFIER_ORDER: readonly Modifier[] = ['ctrl', 'option', 'shift', 'cmd'];
const MODIFIER_LABELS: Readonly<Record<Modifier, string>> = {
    ctrl: 'Ctrl',
    option: 'Option',
    shift: 'Shift',
    cmd: 'Cmd',
};
const WINDOWS_MODIFIER_LABELS: Readonly<Record<Modifier, string>> = {
    ctrl: 'Ctrl',
    option: 'Alt',
    shift: 'Shift',
    cmd: 'Win',
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
/** Control+Shift with these is `@`, `^` or `_` with Control: NUL, RS and US, readline's undo among them. */
const SHIFTED_CONTROL_CODE_KEYS = /^[26-]$/;
/** A key that types a character, which the key encoder never sends with Control and Shift alone. */
const PRINTABLE_KEY = /^([A-Z0-9[\]\\/,.;'`=-]|Space)$/;
/**
 * Windows' own: window and task switching, the window and system menus, Task Manager, Voice Access's microphone keys,
 * and the strict copy and paste keys (P-86).
 */
const WINDOWS_RESERVED: ReadonlySet<string> = new Set([
    'Option+F4',
    'Option+Tab',
    'Option+Shift+Tab',
    'Option+Escape',
    'Ctrl+Escape',
    'Ctrl+Shift+Escape',
    'F10',
    'Shift+F10',
    'Option+Shift+B',
    'Option+Shift+C',
    'Ctrl+Shift+C',
    'Ctrl+Shift+V',
]);
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
    ...['Z', 'X', 'C', 'V', 'A', 'H', 'M', 'Q'].map((key) => `Cmd+${key}`),
    ...['0', '=', '-'].map((key) => `Ctrl+Cmd+${key}`),
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

function defaultChord(command: CommandId, platform: KeymapPlatform): Chord | undefined {
    const text = defaultKeymap(platform)[command];
    return text === undefined ? undefined : parseChord(text);
}

interface Choice {
    readonly command: CommandId;
    readonly chord: Chord | undefined;
    /** Whether the chord is the user's, not the default. */
    readonly rebound: boolean;
    readonly refused?: RefusedBinding;
}

function choose(command: CommandId, binding: string | undefined, platform: KeymapPlatform): Choice {
    const checked = binding === undefined ? undefined : checkBinding(command, binding, platform);
    if (checked === undefined) {
        return { command, chord: defaultChord(command, platform), rebound: false };
    }
    return 'problem' in checked
        ? { command, chord: defaultChord(command, platform), rebound: false, refused: checked }
        : { command, chord: checked, rebound: true };
}

function checkBinding(command: CommandId, binding: string, platform: KeymapPlatform): Chord | RefusedBinding {
    const chord = parseChord(binding);
    if (chord === undefined) {
        return { command, binding, problem: 'unreadable' };
    }
    const problem = bindingProblem(chord, platform);
    return problem === undefined ? chord : { command, binding, problem };
}

function withoutDuplicates(
    choices: readonly Choice[],
    onDuplicate: (command: CommandId, chord: Chord) => void,
    platform: KeymapPlatform,
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
        claim(command, defaultChord(command, platform));
    }
    return chosen;
}

function keymapOf(
    chosen: ReadonlyMap<CommandId, Chord>,
    refused: readonly RefusedBinding[],
    alternates: readonly (readonly [string, CommandId])[],
    platform: KeymapPlatform,
): Keymap {
    const byChord = new Map([...chosen].map(([command, chord]) => [formatChord(chord), command] as const));
    for (const [chord, command] of alternates) {
        if (!byChord.has(chord)) {
            byChord.set(chord, command);
        }
    }
    return {
        commandFor: (chord) => byChord.get(formatChord(chord)),
        chordFor: (command) => chosen.get(command),
        refused,
        platform,
    };
}

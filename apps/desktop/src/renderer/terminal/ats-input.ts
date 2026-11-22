import type { Terminal } from '@xterm/xterm';
import { encodeKey, type KeyAction, type KeyInput } from './key-encoder';

/** What the input layer reports. */
export interface InputSink {
    /** Text or key bytes for the process. */
    send(text: string): void;
    /** Shift+PageUp and Shift+PageDown scroll the view. */
    page(direction: 'up' | 'down'): void;
    /** The IME composition ended; rows may need rebuilding. */
    composed(): void;
    /** The user pasted or dropped text. */
    paste(text: string): void;
}

/** Input state the user toggles (A11Y-04.6, A11Y-05.3, A11Y-05.4). */
export interface InputModes {
    tabFocusMode: boolean;
    sendNextKey: boolean;
    /** Whether Ctrl+C copies a selection instead of interrupting, off macOS (P-86). */
    ctrlCCopies: boolean;
}

/** The element that takes input, and the terminal state that shapes it. */
export interface InputTarget {
    readonly element: HTMLElement;
    readonly terminal: Terminal;
    readonly modes: InputModes;
    readonly isMac: boolean;
    /** The kitty keyboard protocol flags the program asked for. */
    readonly keyboardFlags: () => number;
}

const BEFORE_INPUT_BYTES: Readonly<Record<string, string>> = {
    deleteContentBackward: '\u007f',
    deleteWordBackward: '\u0017',
    deleteContentForward: '\u001b[3~',
    insertLineBreak: '\r',
    insertParagraph: '\r',
};

/** Keys that only modify the next one; pressing one alone sends nothing and keeps send-next-key armed. */
const MODIFIER_KEYS: ReadonlySet<string> = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn', 'AltGraph']);

/**
 * Turns the ATS's keyboard, text-input, composition and paste events into bytes for the process. Every edit is
 * cancelled, so the DOM only ever holds the terminal's text (D-22); IME text is sent once, on `compositionend`.
 */
export function attachInput(target: InputTarget, sink: InputSink): () => void {
    const { element, terminal, modes, isMac, keyboardFlags } = target;
    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.isComposing || MODIFIER_KEYS.has(event.key)) {
            return;
        }
        const passThrough = modes.sendNextKey;
        modes.sendNextKey = false;
        if (!passThrough && leavesToBrowser(event, modes, isMac, terminal)) {
            return;
        }
        const action = encodeKey(keyInputOf(event), {
            applicationCursorKeys: terminal.modes.applicationCursorKeysMode,
            macOptionIsMeta: false,
            isMac,
            kittyFlags: keyboardFlags(),
        });
        perform(action, event, passThrough, sink);
    };
    const onBeforeInput = (event: InputEvent): void => {
        if (event.inputType === 'insertCompositionText') {
            return;
        }
        event.preventDefault();
        if (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrop') {
            sink.paste(event.dataTransfer?.getData('text/plain') ?? '');
            return;
        }
        const text = textOf(event);
        if (text !== undefined && text !== '') {
            sink.send(text);
        }
    };
    const onCompositionEnd = (event: CompositionEvent): void => {
        if (event.data !== '') {
            sink.send(event.data);
        }
        sink.composed();
    };
    element.addEventListener('keydown', onKeyDown);
    element.addEventListener('beforeinput', onBeforeInput);
    element.addEventListener('compositionend', onCompositionEnd);
    return () => {
        element.removeEventListener('keydown', onKeyDown);
        element.removeEventListener('beforeinput', onBeforeInput);
        element.removeEventListener('compositionend', onCompositionEnd);
    };
}

/**
 * Sends a key's bytes or pages the view, keeping the key from the browser; a Ctrl chord with no bytes that
 * send-next-key passed on is kept from the menus too (A11Y-05.3).
 */
function perform(action: KeyAction, event: KeyboardEvent, passThrough: boolean, sink: InputSink): void {
    if (action.kind === 'send') {
        event.preventDefault();
        sink.send(action.bytes);
    } else if (action.kind === 'page') {
        event.preventDefault();
        sink.page(action.direction);
    } else if (passThrough && event.ctrlKey && !event.altKey) {
        event.preventDefault();
    }
}

/**
 * Whether a key press is the browser's, not the process's: Tab in Tab focus mode, which moves focus (A11Y-05.4), and,
 * when the setting is on and the terminal has a selection, Ctrl+C off macOS, which then copies (A11Y-04.6, P-86).
 */
function leavesToBrowser(event: KeyboardEvent, modes: InputModes, isMac: boolean, terminal: Terminal): boolean {
    const alone = !event.altKey && !event.metaKey;
    if (modes.tabFocusMode && event.key === 'Tab' && !event.ctrlKey && alone) {
        return true;
    }
    const ctrlC = event.ctrlKey && !event.shiftKey && alone && event.code === 'KeyC';
    return !isMac && modes.ctrlCCopies && ctrlC && terminal.hasSelection();
}

/** The parts of a key press the encoder reads, with whether AltGr is held, which Chromium reports separately. */
function keyInputOf(event: KeyboardEvent): KeyInput {
    return {
        key: event.key,
        code: event.code,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        altGraph: event.getModifierState('AltGraph'),
    };
}

function textOf(event: InputEvent): string | undefined {
    const bytes = BEFORE_INPUT_BYTES[event.inputType];
    if (bytes !== undefined) {
        return bytes;
    }
    return event.inputType.startsWith('insert') ? (event.data ?? event.dataTransfer?.getData('text/plain')) : undefined;
}

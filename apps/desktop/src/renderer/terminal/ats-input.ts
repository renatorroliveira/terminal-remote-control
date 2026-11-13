import type { Terminal } from '@xterm/xterm';
import { encodeKey } from './key-encoder';

/** What the input layer reports. */
export interface InputSink {
    /** Text or key bytes for the process. */
    send(text: string): void;
    /** Shift+PageUp and Shift+PageDown scroll the view. */
    page(direction: 'up' | 'down'): void;
    /** The IME composition ended; rows may need rebuilding. */
    composed(): void;
}

/** Input state the user toggles (A11Y-05.3, A11Y-05.4). */
export interface InputModes {
    tabFocusMode: boolean;
    sendNextKey: boolean;
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

const BRACKETED_START = '\u001b[200~';
const BRACKETED_END = '\u001b[201~';
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
        if (
            !passThrough &&
            modes.tabFocusMode &&
            event.key === 'Tab' &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.metaKey
        ) {
            return;
        }
        const action = encodeKey(event, {
            applicationCursorKeys: terminal.modes.applicationCursorKeysMode,
            macOptionIsMeta: false,
            isMac,
            kittyFlags: keyboardFlags(),
        });
        if (action.kind === 'send') {
            event.preventDefault();
            sink.send(action.bytes);
        } else if (action.kind === 'page') {
            event.preventDefault();
            sink.page(action.direction);
        }
    };
    const onBeforeInput = (event: InputEvent): void => {
        if (event.inputType === 'insertCompositionText') {
            return;
        }
        event.preventDefault();
        const text = textOf(event, terminal);
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

function textOf(event: InputEvent, terminal: Terminal): string | undefined {
    const bytes = BEFORE_INPUT_BYTES[event.inputType];
    if (bytes !== undefined) {
        return bytes;
    }
    if (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrop') {
        const pasted = event.dataTransfer?.getData('text/plain') ?? '';
        return terminal.modes.bracketedPasteMode ? `${BRACKETED_START}${pasted}${BRACKETED_END}` : pasted;
    }
    return event.inputType.startsWith('insert') ? (event.data ?? event.dataTransfer?.getData('text/plain')) : undefined;
}

import { afterEach, describe, expect, it } from 'vitest';
import { THEMES } from '../ui/themes';
import { TerminalView } from './terminal-view';

interface Harness {
    readonly view: TerminalView;
    readonly host: HTMLElement;
    readonly inputs: string[];
    readonly credits: number[];
    readonly sizes: { cols: number; rows: number }[];
}

const views: TerminalView[] = [];

afterEach(() => {
    for (const view of views.splice(0)) {
        view.dispose();
    }
    document.body.replaceChildren();
});

function mount(): Harness {
    const host = document.createElement('div');
    host.style.width = '800px';
    host.style.height = '400px';
    document.body.append(host);
    const inputs: string[] = [];
    const credits: number[] = [];
    const sizes: { cols: number; rows: number }[] = [];
    const view = new TerminalView({
        palette: THEMES.light,
        isMac: true,
        assistiveTechnology: () => false,
        onInput: (text) => inputs.push(text),
        onCredit: (bytes) => credits.push(bytes),
        onResize: (size) => sizes.push(size),
    });
    view.mount(host);
    view.setLabel('build, devbox-1', 'Option F1: accessibility help.');
    views.push(view);
    return { view, host, inputs, credits, sizes };
}

async function written(view: TerminalView, text: string): Promise<void> {
    await view.write(new TextEncoder().encode(text));
    await frames();
}

function frames(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function rowsText(view: TerminalView): string[] {
    return [...view.surface.querySelectorAll<HTMLElement>('[data-row]')].map((row) => row.textContent ?? '');
}

function key(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
}

function beforeInput(target: HTMLElement, inputType: string, data: string | null): InputEvent {
    const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType, data });
    target.dispatchEvent(event);
    return event;
}

describe('TerminalView: the Accessible Text Surface (A11Y-01, A11Y-04, A11Y-06)', () => {
    it('is one named, multiline, editable text box over a canvas hidden from assistive technology', () => {
        const { view, host } = mount();
        const surface = view.surface;
        expect(surface.getAttribute('role')).toBe('textbox');
        expect(surface.getAttribute('aria-multiline')).toBe('true');
        expect(surface.getAttribute('aria-label')).toBe('build, devbox-1');
        expect(surface.contentEditable).toBe('true');
        expect(surface.tabIndex).toBe(0);
        const hint = document.getElementById(surface.getAttribute('aria-describedby') ?? '');
        expect(hint?.textContent).toBe('Option F1: accessibility help.');
        expect(host.querySelector('.xterm')?.getAttribute('aria-hidden')).toBe('true');
        expect(host.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.tabIndex).toBe(-1);
    });

    it('exposes the terminal rows as real text', async () => {
        const { view } = mount();
        await written(view, 'hello\r\nworld');
        expect(rowsText(view).slice(0, 2)).toEqual(['hello', 'world']);
    });

    it('puts a collapsed caret at the terminal cursor while focused', async () => {
        const { view } = mount();
        view.surface.focus();
        await written(view, 'ab\r\ncd');
        const selection = getSelection();
        expect(selection?.isCollapsed).toBe(true);
        expect(selection?.anchorNode?.parentElement?.dataset['row']).toBe('1');
        expect(selection?.anchorOffset).toBe(2);
    });

    it('mirrors a terminal selection into the DOM and a DOM selection into the terminal', async () => {
        const { view } = mount();
        view.surface.focus();
        await written(view, 'hello world');
        view.terminal.select(6, 0, 5);
        await frames();
        expect(getSelection()?.toString()).toBe('world');
        const text = view.surface.querySelector('[data-row="0"]')?.firstChild as Text;
        getSelection()?.setBaseAndExtent(text, 0, text, 5);
        await frames();
        expect(view.terminal.getSelection()).toBe('hello');
    });

    it('lets a pointer drag own the DOM selection until the button is released', async () => {
        const { view } = mount();
        view.surface.focus();
        await written(view, 'drag me please');
        view.surface.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
        const text = view.surface.querySelector('[data-row="0"]')?.firstChild as Text;
        getSelection()?.setBaseAndExtent(text, 0, text, 4);
        await written(view, '');
        expect(getSelection()?.toString()).toBe('drag');
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
        await frames();
        expect(view.terminal.getSelection()).toBe('drag');
    });
});

describe('TerminalView: input (A11Y-09, D-22)', () => {
    it('sends keys and text input without ever editing the DOM', async () => {
        const { view, inputs } = mount();
        view.surface.focus();
        await written(view, '$ ');
        const before = view.surface.innerHTML;
        expect(key(view.surface, { key: 'Enter', code: 'Enter' }).defaultPrevented).toBe(true);
        expect(key(view.surface, { key: 'c', code: 'KeyC', ctrlKey: true }).defaultPrevented).toBe(true);
        expect(beforeInput(view.surface, 'insertText', 'ls').defaultPrevented).toBe(true);
        expect(beforeInput(view.surface, 'deleteContentBackward', null).defaultPrevented).toBe(true);
        expect(inputs).toEqual(['\r', '\u0003', 'ls', '\u007f']);
        expect(view.surface.innerHTML).toBe(before);
    });

    it('sends committed IME text exactly once', () => {
        const { view, inputs } = mount();
        view.surface.focus();
        beforeInput(view.surface, 'insertCompositionText', 'に');
        view.surface.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日本' }));
        expect(inputs).toEqual(['日本']);
    });

    it('clears the selection and returns the caret to the cursor when the user types', async () => {
        const { view } = mount();
        view.surface.focus();
        await written(view, 'select this');
        view.terminal.select(0, 0, 6);
        await frames();
        beforeInput(view.surface, 'insertText', 'x');
        expect(view.terminal.hasSelection()).toBe(false);
        expect(getSelection()?.isCollapsed).toBe(true);
    });

    it('wraps pasted text in bracketed paste when the program asked for it', async () => {
        const { view, inputs } = mount();
        view.surface.focus();
        await written(view, '\u001b[?2004h');
        const data = new DataTransfer();
        data.setData('text/plain', 'echo pasted');
        view.surface.dispatchEvent(
            new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertFromPaste',
                dataTransfer: data,
            }),
        );
        expect(inputs).toEqual(['\u001b[200~echo pasted\u001b[201~']);
    });
});

describe('TerminalView: focus and pointer (A11Y-05, A11Y-06)', () => {
    it('lets Tab move focus in Tab focus mode, and sends the next key anyway when asked (A11Y-05.3, A11Y-05.4)', () => {
        const { view, inputs } = mount();
        view.surface.focus();
        expect(key(view.surface, { key: 'Tab', code: 'Tab' }).defaultPrevented).toBe(true);
        view.setTabFocusMode(true);
        expect(key(view.surface, { key: 'Tab', code: 'Tab' }).defaultPrevented).toBe(false);
        view.sendNextKey();
        expect(key(view.surface, { key: 'Tab', code: 'Tab' }).defaultPrevented).toBe(true);
        expect(inputs).toEqual(['\t', '\t']);
    });

    it('lets the pointer reach the program while it tracks the mouse', async () => {
        const { view } = mount();
        expect(getComputedStyle(view.surface).pointerEvents).toBe('auto');
        await written(view, '\u001b[?1000h');
        expect(getComputedStyle(view.surface).pointerEvents).toBe('none');
        await written(view, '\u001b[?1000l');
        expect(getComputedStyle(view.surface).pointerEvents).toBe('auto');
    });

    it('reports focus changes when the program asks for them', async () => {
        const { view, inputs } = mount();
        await written(view, '\u001b[?1004h');
        view.surface.focus();
        view.surface.blur();
        expect(inputs).toEqual(['\u001b[I', '\u001b[O']);
    });
});

describe('TerminalView: output (US-1.11, SEC-06, D-19)', () => {
    it('returns credit as xterm parses output', async () => {
        const { view, credits } = mount();
        await written(view, 'x'.repeat(70 * 1024));
        expect(credits.reduce((sum, bytes) => sum + bytes, 0)).toBe(70 * 1024);
    });

    it('swallows terminal queries, which the daemon answers', async () => {
        const { view, inputs } = mount();
        await written(view, '\u001b[c\u001b[>c\u001b[6n\u001b[5n\u001b]11;?\u0007\u001b[?2004$p\u001bP$qm\u001b\\');
        expect(inputs).toEqual([]);
    });

    it('draws a distinct cursor while focused (A11Y-06.6)', () => {
        const { view } = mount();
        expect(view.terminal.options.cursorInactiveStyle).toBe('outline');
        view.surface.focus();
        expect(view.terminal.options.cursorInactiveStyle).toBe('block');
        view.surface.blur();
        expect(view.terminal.options.cursorInactiveStyle).toBe('outline');
    });

    it('fits the terminal to its host and reports the size', async () => {
        const { sizes } = mount();
        await frames();
        expect(sizes.at(-1)?.cols).toBeGreaterThan(40);
        expect(sizes.at(-1)?.rows).toBeGreaterThan(10);
    });
});

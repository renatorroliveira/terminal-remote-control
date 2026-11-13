import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { THEMES } from '../ui/themes';
import { SELECTION_CAP } from './ats-surface';
import type { TerminalLink } from './hyperlinks';
import { TerminalView, type TerminalViewOptions } from './terminal-view';

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

function mount(overrides: Partial<TerminalViewOptions> = {}): Harness {
    const host = document.createElement('div');
    host.style.width = '800px';
    host.style.height = '400px';
    document.body.append(host);
    const inputs: string[] = [];
    const credits: number[] = [];
    const sizes: { cols: number; rows: number }[] = [];
    const view = new TerminalView({
        palette: THEMES.midnight.terminal,
        isMac: true,
        assistiveTechnology: () => false,
        onInput: (text) => inputs.push(text),
        onCredit: (bytes) => credits.push(bytes),
        onResize: (size) => sizes.push(size),
        ...overrides,
    });
    view.mount(host);
    view.setLabel('build, devbox-1', 'Option F1: accessibility help.');
    views.push(view);
    return { view, host, inputs, credits, sizes };
}

async function written(view: TerminalView, text: string): Promise<void> {
    await view.ready;
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
    it('is one named, multiline, editable text box over a canvas hidden from assistive technology', async () => {
        const { view, host } = mount();
        await view.ready;
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

async function scrolledHistory(view: TerminalView): Promise<void> {
    const lines = Array.from({ length: 200 }, (_, index) => `line ${index}`).join('\r\n');
    await written(view, lines);
}

function drag(view: TerminalView, clientY: number): void {
    view.surface.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1 }));
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, clientX: 40, clientY }));
}

function pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('TerminalView: dragging a selection past an edge (A11Y-04)', () => {
    it('scrolls down and extends the selection while the pointer is below the terminal', async () => {
        const { view } = mount();
        view.surface.focus();
        await scrolledHistory(view);
        view.terminal.scrollToTop();
        await frames();
        const text = view.surface.querySelector('[data-row="0"]')?.firstChild as Text;
        drag(view, view.surface.getBoundingClientRect().bottom + 40);
        getSelection()?.setBaseAndExtent(text, 0, text, 4);
        await pause(400);
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
        await frames();
        const viewport = view.terminal.buffer.active.viewportY;
        expect(viewport).toBeGreaterThan(0);
        expect(view.terminal.getSelectionPosition()?.start.y).toBe(0);
        expect(view.terminal.getSelectionPosition()?.end.y).toBe(viewport + view.terminal.rows - 1);
        await pause(200);
        expect(view.terminal.buffer.active.viewportY).toBe(viewport);
    });

    it('scrolls up and extends the selection while the pointer is above the terminal', async () => {
        const { view } = mount();
        view.surface.focus();
        await scrolledHistory(view);
        const bottom = view.terminal.buffer.active.viewportY;
        const last = bottom + view.terminal.rows - 1;
        const text = view.surface.querySelector(`[data-row="${last}"]`)?.firstChild as Text;
        drag(view, view.surface.getBoundingClientRect().top - 40);
        getSelection()?.setBaseAndExtent(text, 3, text, 0);
        await pause(400);
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
        await frames();
        const viewport = view.terminal.buffer.active.viewportY;
        expect(viewport).toBeLessThan(bottom);
        expect(view.terminal.getSelectionPosition()?.start.y).toBe(viewport);
    });

    it('scrolls faster the farther the pointer is past the edge', async () => {
        const scrolled: number[] = [];
        for (const distance of [2, 200]) {
            const { view } = mount();
            view.surface.focus();
            await scrolledHistory(view);
            view.terminal.scrollToTop();
            await frames();
            drag(view, view.surface.getBoundingClientRect().bottom + distance);
            await pause(300);
            window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
            scrolled.push(view.terminal.buffer.active.viewportY);
        }
        expect(scrolled[1]).toBeGreaterThan(scrolled[0] ?? 0);
    });
});

/** The color of the pixel at (`x`, `y`) inside `element`, as rendered on screen. */
async function pixelAt(element: HTMLElement, x: number, y: number): Promise<readonly number[]> {
    const image = new Image();
    image.src = `data:image/png;base64,${await page.screenshot({ element, save: false })}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context?.drawImage(image, 0, 0);
    const scale = image.width / element.getBoundingClientRect().width;
    return [...(context?.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data.slice(0, 3) ?? [])];
}

function near(actual: readonly number[], expected: readonly number[]): boolean {
    return expected.every((channel, index) => Math.abs((actual[index] ?? -255) - channel) <= 12);
}

describe('TerminalView: cursor and selection colors (A11Y-06.6, A11Y-04)', () => {
    it('draws a phosphor green block cursor at the prompt, before the terminal ever had xterm focus', async () => {
        const { view, host } = mount();
        view.surface.focus();
        await written(view, '$ ');
        await frames();
        const caret = getSelection()?.getRangeAt(0).getBoundingClientRect();
        const box = host.getBoundingClientRect();
        const color = await pixelAt(host, (caret?.left ?? 0) - box.left + 3, (caret?.top ?? 0) - box.top + 6);
        expect(near(color, [0, 173, 44]), `cursor pixel ${color.join(',')}`).toBe(true);
    });

    it('fills selected cells with dark green', async () => {
        const { view, host } = mount();
        view.surface.focus();
        await written(view, 'a     b');
        view.terminal.select(0, 0, 7);
        await frames();
        const row = view.surface.querySelector('[data-row="0"]')?.getBoundingClientRect();
        const box = host.getBoundingClientRect();
        const cell = (row?.width ?? 0) / view.terminal.cols;
        const color = await pixelAt(host, (row?.left ?? 0) - box.left + cell * 3.5, (row?.top ?? 0) - box.top + 4);
        expect(near(color, [0, 107, 36]), `selection pixel ${color.join(',')}`).toBe(true);
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

describe('TerminalView: keyboard protocol (US-1.11)', () => {
    it('sends Shift+Enter as CSI 13;2u once the program turns on kitty disambiguation', async () => {
        const { view, inputs } = mount();
        await written(view, '');
        key(view.surface, { key: 'Enter', code: 'Enter', shiftKey: true });
        await written(view, '\u001b[>1u');
        key(view.surface, { key: 'Enter', code: 'Enter', shiftKey: true });
        expect(inputs).toEqual(['\r', '\u001b[13;2u']);
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

    it('keeps send-next-key armed through the modifier keys pressed before the key itself (A11Y-05.3)', () => {
        const { view, inputs } = mount();
        view.surface.focus();
        view.setTabFocusMode(true);
        view.sendNextKey();
        key(view.surface, { key: 'Shift', code: 'ShiftLeft', shiftKey: true });
        expect(view.passingNextKey).toBe(true);
        expect(key(view.surface, { key: 'Tab', code: 'Tab', shiftKey: true }).defaultPrevented).toBe(true);
        expect(view.passingNextKey).toBe(false);
        expect(inputs).toEqual(['\u001b[Z']);
    });

    it('keeps the text surface above every xterm layer, so the pointer selects real text (A11Y-04)', async () => {
        const { view } = mount();
        await written(view, 'hello world');
        const box = view.surface.getBoundingClientRect();
        const points = [
            [box.left + 5, box.top + 5],
            [box.left + box.width / 2, box.top + box.height / 2],
            [Math.min(box.right, window.innerWidth) - 30, Math.min(box.bottom, window.innerHeight) - 5],
        ] as const;
        const hits = points.map(([x, y]) => {
            const element = document.elementFromPoint(x, y);
            return view.surface.contains(element) ? 'surface' : `${element?.tagName}.${element?.className}`;
        });
        expect(hits).toEqual(['surface', 'surface', 'surface']);
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

function textRect(view: TerminalView, row: number, start: number, end: number): DOMRect {
    const node = view.surface.querySelector(`[data-row="${row}"]`)?.firstChild;
    const range = document.createRange();
    if (node instanceof Text) {
        range.setStart(node, start);
        range.setEnd(node, end);
    }
    return range.getBoundingClientRect();
}

describe('TerminalView: grid alignment (A11Y-04.5, A11Y-06.3)', () => {
    it('renders the terminal in Intel One Mono at 14 px', async () => {
        const { view } = mount();
        await view.ready;
        expect(view.terminal.options.fontFamily).toContain('Intel One Mono');
        expect(view.terminal.options.fontSize).toBe(14);
        expect(document.fonts.check('14px "Intel One Mono"')).toBe(true);
        expect(getComputedStyle(view.surface).fontFamily).toContain('Intel One Mono');
    });

    it('lays every surface row over its terminal row, one character per cell', async () => {
        const { view } = mount();
        await view.ready;
        await written(view, `${'x'.repeat(60)}\r\n${'y'.repeat(10)}\r\nz`);
        const screen = view.terminal.element?.querySelector('.xterm-screen')?.getBoundingClientRect();
        const cellWidth = (screen?.width ?? 0) / view.terminal.cols;
        const cellHeight = (screen?.height ?? 0) / view.terminal.rows;
        const wide = textRect(view, 0, 0, 60);
        expect(Math.abs(wide.left - (screen?.left ?? 0))).toBeLessThan(1);
        expect(Math.abs(wide.width - 60 * cellWidth)).toBeLessThan(cellWidth / 2);
        const third = textRect(view, 2, 0, 1);
        expect(Math.abs(third.top - ((screen?.top ?? 0) + 2 * cellHeight))).toBeLessThan(cellHeight / 4);
        expect(Math.abs(third.height - cellHeight)).toBeLessThan(cellHeight / 4);
    });

    it('puts the caret on the cursor cell, where Zoom and the IME window follow it', async () => {
        const { view } = mount();
        await view.ready;
        view.surface.focus();
        await written(view, 'prompt$ ');
        const screen = view.terminal.element?.querySelector('.xterm-screen')?.getBoundingClientRect();
        const cellWidth = (screen?.width ?? 0) / view.terminal.cols;
        const caret = getSelection()?.getRangeAt(0).getBoundingClientRect();
        expect(Math.abs((caret?.left ?? 0) - ((screen?.left ?? 0) + 8 * cellWidth))).toBeLessThan(cellWidth / 2);
        expect(caret?.height ?? 0).toBeGreaterThan(0);
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
});

describe('TerminalView: layout and size (A11Y-07.5, US-1.11.3)', () => {
    it('keeps 20 px between the terminal border, where the focus ring is drawn, and the text', async () => {
        const { view } = mount();
        await view.ready;
        const bordered = view.surface.parentElement?.getBoundingClientRect();
        const grid = view.surface.getBoundingClientRect();
        const screen = view.terminal.element?.querySelector('.xterm-screen')?.getBoundingClientRect();
        expect(grid.top - (bordered?.top ?? 0)).toBe(20);
        expect(grid.left - (bordered?.left ?? 0)).toBe(20);
        expect((screen?.left ?? 0) - (bordered?.left ?? 0)).toBe(20);
        expect((bordered?.right ?? 0) - grid.right).toBeGreaterThanOrEqual(20);
    });

    it('caps the grid at 120 columns, centered in a wide frame, and drops columns in a narrow one (A11Y-07.5)', async () => {
        const { view, host, sizes } = mount();
        host.style.width = '1800px';
        await view.ready;
        await frames();
        expect(view.terminal.cols).toBe(120);
        const frameBox = host.getBoundingClientRect();
        const gridBox = view.surface.parentElement?.getBoundingClientRect();
        const leftGap = (gridBox?.left ?? 0) - frameBox.left;
        const rightGap = frameBox.right - (gridBox?.right ?? 0);
        expect(Math.abs(leftGap - rightGap)).toBeLessThan(2);
        host.style.width = '400px';
        await frames();
        await frames();
        expect(view.terminal.cols).toBeLessThan(60);
        expect(sizes.at(-1)?.cols).toBe(view.terminal.cols);
    });

    it('reports every size change as just columns and rows, which the daemon accepts (US-1.11.3)', async () => {
        const { view, host, sizes } = mount();
        await view.ready;
        host.style.width = '600px';
        await frames();
        await frames();
        expect(sizes.length).toBeGreaterThan(1);
        for (const size of sizes) {
            expect(Object.keys(size).sort()).toEqual(['cols', 'rows']);
        }
        expect(sizes.at(-1)).toEqual({ cols: view.terminal.cols, rows: view.terminal.rows });
    });

    it('fits the terminal to its host and reports the size', async () => {
        const { view, sizes } = mount();
        await view.ready;
        await frames();
        expect(sizes.at(-1)?.cols).toBeGreaterThan(40);
        expect(sizes.at(-1)?.rows).toBeGreaterThan(10);
    });
});

/** The center of the characters of `part` in the row that holds them. */
function centerOf(view: TerminalView, part: string): { readonly clientX: number; readonly clientY: number } {
    const row = [...view.surface.querySelectorAll<HTMLElement>('[data-row]')].find((element) =>
        element.textContent?.includes(part),
    );
    const text = row?.firstChild;
    if (!(text instanceof Text)) {
        throw new Error(`no row holds ${part}`);
    }
    const range = document.createRange();
    const start = text.data.indexOf(part);
    range.setStart(text, start);
    range.setEnd(text, start + part.length);
    const box = range.getBoundingClientRect();
    return { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
}

describe('TerminalView: links (US-1.12.3)', () => {
    function linkHarness(isMac: boolean) {
        const opened: TerminalLink[] = [];
        const harness = mount({ isMac, onLink: (link) => opened.push(link) });
        return { ...harness, opened };
    }

    function click(view: TerminalView, part: string, init: MouseEventInit): MouseEvent {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...centerOf(view, part), ...init });
        view.surface.dispatchEvent(event);
        return event;
    }

    it('opens the URL under a Command+click, and leaves a plain click to the text', async () => {
        const { view, opened } = linkHarness(true);
        await written(view, 'docs at https://example.com/docs today');
        expect(click(view, 'example', {}).defaultPrevented).toBe(false);
        expect(click(view, 'today', { metaKey: true }).defaultPrevented).toBe(false);
        expect(opened).toEqual([]);
        expect(click(view, 'example', { metaKey: true }).defaultPrevented).toBe(true);
        expect(opened).toEqual([{ text: 'https://example.com/docs', target: 'https://example.com/docs' }]);
    });

    it('uses Control+click off macOS', async () => {
        const { view, opened } = linkHarness(false);
        await written(view, 'https://example.com');
        click(view, 'example', { metaKey: true });
        click(view, 'example', { ctrlKey: true });
        expect(opened.map((link) => link.target)).toEqual(['https://example.com']);
    });

    it('shows the pointer hand over a link while the modifier is held', async () => {
        const { view } = linkHarness(true);
        await written(view, 'see https://example.com');
        const move = (part: string, metaKey: boolean): void => {
            view.surface.dispatchEvent(
                new MouseEvent('mousemove', { bubbles: true, ...centerOf(view, part), metaKey }),
            );
        };
        move('example', true);
        expect(view.surface.style.cursor).toBe('pointer');
        move('example', false);
        expect(view.surface.style.cursor).toBe('');
        move('see', true);
        expect(view.surface.style.cursor).toBe('');
    });

    it('lists the links on the screen', async () => {
        const { view } = linkHarness(true);
        await written(view, 'one https://example.com/1\r\ntwo https://example.com/2');
        expect(view.visibleLinks().map((link) => link.target)).toEqual([
            'https://example.com/1',
            'https://example.com/2',
        ]);
    });
});

function paste(view: TerminalView, text: string): void {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    view.surface.dispatchEvent(
        new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertFromPaste',
            dataTransfer: data,
        }),
    );
}

describe('TerminalView: paste and copy (US-1.12.1, US-1.12.2, A11Y-04.7)', () => {
    it('asks before pasting more than one line, and sends the text once confirmed', async () => {
        const requests: string[] = [];
        const { view, inputs } = mount({ onPasteRequest: (text) => requests.push(text) });
        await written(view, '');
        paste(view, 'one line');
        paste(view, 'make\nmake install\n');
        expect(inputs).toEqual(['one line']);
        expect(requests).toEqual(['make\nmake install\n']);
        view.paste('make\nmake install\n');
        expect(inputs).toEqual(['one line', 'make\rmake install\r']);
    });

    it('copies the selection as logical lines, joining soft-wrapped rows', async () => {
        const { view } = mount();
        const long = 'x'.repeat(view.terminal.cols + 10);
        await written(view, `${long}\r\nnext`);
        view.terminal.select(0, 0, view.terminal.cols * 2 + 'next'.length);
        const data = new DataTransfer();
        const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data });
        view.surface.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(data.getData('text/plain')).toBe(`${long}\nnext`);
    });

    it('copies a selection past the cap whole, and reports that the OS sees only part of it', async () => {
        const notices: unknown[] = [];
        const { view } = mount({ onNotice: (notice) => notices.push(notice) });
        const lines = SELECTION_CAP + 1;
        await written(view, Array.from({ length: lines }, (_, index) => String(index)).join('\r\n'));
        view.terminal.selectAll();
        const data = new DataTransfer();
        view.surface.dispatchEvent(
            new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }),
        );
        expect(data.getData('text/plain').split('\n').slice(0, lines)).toEqual(
            Array.from({ length: lines }, (_, index) => String(index)),
        );
        expect(notices).toEqual([{ kind: 'copy-capped', lines: expect.any(Number) }]);
    });

    it('opens the context menu from the pointer, Shift+F10 and the Menu key, saying whether there is a selection', async () => {
        const menus: boolean[] = [];
        const { view, inputs } = mount({ onContextMenu: (canCopy) => menus.push(canCopy) });
        await written(view, 'hello');
        view.surface.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        view.terminal.select(0, 0, 'hello'.length);
        key(view.surface, { key: 'F10', code: 'F10', shiftKey: true });
        key(view.surface, { key: 'ContextMenu', code: 'ContextMenu' });
        expect(menus).toEqual([false, true, true]);
        expect(inputs).toEqual([]);
    });
});

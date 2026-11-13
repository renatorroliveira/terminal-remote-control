import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes';
import { WebglAddon } from '@xterm/addon-webgl';
import { type IDisposable, Terminal } from '@xterm/xterm';
import type { TerminalPalette } from '../ui/themes';
import { attachInput, type InputModes } from './ats-input';
import { AtsSurface } from './ats-surface';
import { CreditTracker } from './credit-tracker';
import { registerQueryFilters } from './query-filter';
import { SCROLLBAR_WIDTH, TerminalGeometry } from './terminal-geometry';
import { xtermTheme } from './terminal-theme';
import { UpdateScheduler } from './update-scheduler';
import '@xterm/xterm/css/xterm.css';
import '../ui/fonts.css';
import styles from './terminal-view.module.css';

/** What a terminal view needs from its session. */
export interface TerminalViewOptions {
    /** The terminal colors, apart from the UI's. */
    readonly palette: TerminalPalette;
    readonly isMac: boolean;
    /** Whether assistive technology is active, which slows the ATS cadence (S3a). */
    readonly assistiveTechnology: () => boolean;
    /** Bytes for the process, as text. */
    readonly onInput: (text: string) => void;
    /** Output credit to return to the daemon (D-19). */
    readonly onCredit: (bytes: number) => void;
    /** The terminal's size changed; the PTY follows (US-1.11.3). */
    readonly onResize: (size: { readonly cols: number; readonly rows: number }) => void;
    /** The widest the grid gets; narrower spaces get fewer columns (A11Y-07.5). */
    readonly maxColumns?: number;
}

/** The terminal font, embedded in the app. */
export const TERMINAL_FONT_FAMILY = '"Intel One Mono", monospace';
/** The terminal font size, in CSS pixels. */
export const TERMINAL_FONT_SIZE = 14;
/** The grid's default maximum width. */
export const DEFAULT_MAX_COLUMNS = 120;
const SCROLLBACK_LINES = 10_000;
const FOCUS_IN = '\u001b[I';
const FOCUS_OUT = '\u001b[O';

let hintCounter = 0;

/**
 * One session's terminal: an xterm.js canvas for sight, and over it the Accessible Text Surface, the single focus
 * target that gives the OS real text, selection and a caret (TECH_STACK §4.3). Lives outside React.
 */
export class TerminalView {
    /** The xterm.js terminal. */
    readonly terminal: Terminal;
    /** The Accessible Text Surface element. */
    readonly surface: HTMLElement;
    readonly #options: TerminalViewOptions;
    readonly #hint: HTMLElement;
    readonly #ats: AtsSurface;
    readonly #scheduler: UpdateScheduler;
    readonly #credit: CreditTracker;
    readonly #measurer: HTMLElement;
    readonly #modes: InputModes = { tabFocusMode: false, sendNextKey: false };
    readonly #cleanups: (() => void)[] = [];
    #geometry: TerminalGeometry | undefined;
    #ready: Promise<void> = Promise.resolve();
    #disposed = false;

    /** Creates a view; call {@link TerminalView.mount} to show it. */
    constructor(options: TerminalViewOptions) {
        this.#options = options;
        this.terminal = new Terminal({
            allowProposedApi: true,
            fontFamily: TERMINAL_FONT_FAMILY,
            fontSize: TERMINAL_FONT_SIZE,
            scrollback: SCROLLBACK_LINES,
            cursorStyle: 'block',
            cursorInactiveStyle: 'outline',
            minimumContrastRatio: 4.5,
            screenReaderMode: false,
            macOptionIsMeta: false,
            overviewRuler: { width: SCROLLBAR_WIDTH },
            theme: xtermTheme(options.palette),
        });
        this.surface = createSurface();
        this.#hint = createHint();
        this.#measurer = createMeasurer();
        this.#ats = new AtsSurface(this.terminal, this.surface);
        this.#scheduler = new UpdateScheduler(() => this.#ats.update(), options.assistiveTechnology);
        this.#credit = new CreditTracker(options.onCredit);
    }

    /**
     * Shows the terminal in `container`, which it fills, centered and at most `maxColumns` wide. Input and output work at once; the
     * canvas opens once the terminal font has loaded, and {@link TerminalView.ready} settles then.
     */
    mount(container: HTMLElement): void {
        const frame = document.createElement('div');
        frame.className = styles['frame'] ?? '';
        const host = document.createElement('div');
        host.className = styles['host'] ?? '';
        const canvas = document.createElement('div');
        canvas.className = styles['canvas'] ?? '';
        host.append(canvas, this.surface, this.#hint, this.#measurer);
        frame.append(host);
        container.append(frame);
        this.surface.setAttribute('aria-describedby', this.#hint.id);
        this.#listen();
        this.#geometry = new TerminalGeometry(
            this.terminal,
            { frame, host, surface: this.surface, measurer: this.#measurer },
            this.#ats,
            this.#options.maxColumns ?? DEFAULT_MAX_COLUMNS,
        );
        this.#ready = loadTerminalFonts().then(() => this.#open(canvas));
    }

    /** Settles once the canvas is open and the grid fits its frame. */
    get ready(): Promise<void> {
        return this.#ready;
    }

    /** Feeds output from the daemon; resolves once xterm has parsed it. */
    write(data: Uint8Array): Promise<void> {
        this.#scheduler.output(data.length);
        return new Promise((resolve) => {
            this.terminal.write(data, () => {
                this.#credit.parsed(data.length);
                resolve();
            });
        });
    }

    /** Sets the accessible name (session, host and state) and the shortcut hint (A11Y-01.1, A11Y-01.2). */
    setLabel(name: string, hint: string): void {
        this.surface.setAttribute('aria-label', name);
        this.#hint.textContent = hint;
    }

    /** Applies a theme's terminal colors. */
    setPalette(palette: TerminalPalette): void {
        this.terminal.options.theme = xtermTheme(palette);
    }

    /** Makes Tab and Shift+Tab move focus instead of reaching the process (A11Y-05.4). */
    setTabFocusMode(on: boolean): void {
        this.#modes.tabFocusMode = on;
    }

    /** Whether Tab focus mode is on. */
    get tabFocusMode(): boolean {
        return this.#modes.tabFocusMode;
    }

    /** Sends the next key to the process even if the app reserves it (A11Y-05.3). */
    sendNextKey(): void {
        this.#modes.sendNextKey = true;
    }

    /** Moves keyboard focus to the surface. */
    focus(): void {
        this.surface.focus();
    }

    /** Releases the terminal and its listeners. */
    dispose(): void {
        this.#disposed = true;
        this.#geometry?.dispose();
        for (const cleanup of this.#cleanups.splice(0)) {
            cleanup();
        }
        this.terminal.dispose();
    }

    #open(canvas: HTMLElement): Promise<void> {
        if (this.#disposed) {
            return Promise.resolve();
        }
        this.terminal.open(canvas);
        this.terminal.element?.setAttribute('aria-hidden', 'true');
        this.#loadAddons();
        this.#tameXtermFocus(canvas);
        const fitted = this.#geometry?.observe() ?? Promise.resolve();
        this.#scheduler.request();
        return fitted.then(() => this.#options.onResize({ cols: this.terminal.cols, rows: this.terminal.rows }));
    }

    #loadAddons(): void {
        const graphemes = new UnicodeGraphemesAddon();
        this.terminal.loadAddon(graphemes);
        this.terminal.unicode.activeVersion = '15-graphemes';
        try {
            const webgl = new WebglAddon();
            webgl.onContextLoss(() => webgl.dispose());
            this.terminal.loadAddon(webgl);
        } catch {
            return;
        }
    }

    #tameXtermFocus(canvas: HTMLElement): void {
        const textarea = canvas.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
        if (textarea === null) {
            return;
        }
        textarea.tabIndex = -1;
        const redirect = (): void => this.surface.focus();
        textarea.addEventListener('focus', redirect);
        this.#cleanups.push(() => textarea.removeEventListener('focus', redirect));
    }

    #listen(): void {
        const request = (): void => this.#scheduler.request();
        const disposables: IDisposable[] = [
            ...registerQueryFilters(this.terminal),
            this.terminal.onWriteParsed(() => {
                this.#syncPointerMode();
                request();
            }),
            this.terminal.onScroll(request),
            this.terminal.onSelectionChange(request),
            this.terminal.onResize((size) => {
                this.#geometry?.align();
                this.#options.onResize(size);
                request();
            }),
            this.terminal.onData((data) => this.#forwardTerminalData(data)),
        ];
        this.#cleanups.push(() => {
            for (const disposable of disposables) {
                disposable.dispose();
            }
        });
        this.#cleanups.push(this.#ats.listen(this.#scheduler));
        this.#cleanups.push(
            attachInput(
                { element: this.surface, terminal: this.terminal, modes: this.#modes, isMac: this.#options.isMac },
                this.#inputSink(),
            ),
        );
        this.#listenFocus(request);
        this.#listenWheel();
    }

    #syncPointerMode(): void {
        this.surface.dataset['mouse'] = this.terminal.modes.mouseTrackingMode === 'none' ? 'off' : 'on';
    }

    #forwardTerminalData(data: string): void {
        if (data !== FOCUS_IN && data !== FOCUS_OUT) {
            this.#options.onInput(data);
        }
    }

    #inputSink() {
        return {
            send: (text: string): void => {
                this.terminal.clearSelection();
                this.terminal.scrollToBottom();
                this.#ats.placeCaret();
                this.#options.onInput(text);
            },
            page: (direction: 'up' | 'down'): void => this.terminal.scrollPages(direction === 'up' ? -1 : 1),
            composed: (): void => {
                this.#ats.resetRows();
                this.#scheduler.request();
            },
        };
    }

    #listenFocus(request: () => void): void {
        const onFocus = (): void => {
            this.terminal.options.cursorInactiveStyle = 'block';
            if (this.terminal.modes.sendFocusMode) {
                this.#options.onInput(FOCUS_IN);
            }
            request();
        };
        const onBlur = (): void => {
            this.terminal.options.cursorInactiveStyle = 'outline';
            if (this.terminal.modes.sendFocusMode) {
                this.#options.onInput(FOCUS_OUT);
            }
        };
        this.surface.addEventListener('focus', onFocus);
        this.surface.addEventListener('blur', onBlur);
        this.#cleanups.push(() => {
            this.surface.removeEventListener('focus', onFocus);
            this.surface.removeEventListener('blur', onBlur);
        });
    }

    #listenWheel(): void {
        const onWheel = (event: WheelEvent): void => {
            const height = this.surface.getBoundingClientRect().height / Math.max(1, this.terminal.rows);
            const lines =
                Math.sign(event.deltaY) * Math.max(1, Math.round(Math.abs(event.deltaY) / Math.max(1, height)));
            event.preventDefault();
            this.terminal.scrollLines(lines);
        };
        this.surface.addEventListener('wheel', onWheel, { passive: false });
        this.#cleanups.push(() => this.surface.removeEventListener('wheel', onWheel));
    }
}

function createSurface(): HTMLElement {
    const surface = document.createElement('div');
    surface.className = styles['surface'] ?? '';
    surface.contentEditable = 'true';
    surface.setAttribute('role', 'textbox');
    surface.setAttribute('aria-multiline', 'true');
    surface.setAttribute('spellcheck', 'false');
    surface.setAttribute('autocapitalize', 'off');
    surface.setAttribute('autocorrect', 'off');
    surface.setAttribute('translate', 'no');
    surface.tabIndex = 0;
    surface.style.fontFamily = TERMINAL_FONT_FAMILY;
    surface.style.fontSize = `${TERMINAL_FONT_SIZE}px`;
    return surface;
}

function createHint(): HTMLElement {
    hintCounter += 1;
    const hint = document.createElement('span');
    hint.id = `trc-terminal-hint-${hintCounter}`;
    hint.hidden = true;
    return hint;
}

function createMeasurer(): HTMLElement {
    const measurer = document.createElement('span');
    measurer.className = styles['measurer'] ?? '';
    measurer.setAttribute('aria-hidden', 'true');
    measurer.style.fontFamily = TERMINAL_FONT_FAMILY;
    measurer.style.fontSize = `${TERMINAL_FONT_SIZE}px`;
    return measurer;
}

function loadTerminalFonts(): Promise<void> {
    const fonts = [`${TERMINAL_FONT_SIZE}px "Intel One Mono"`, `italic ${TERMINAL_FONT_SIZE}px "Intel One Mono"`];
    return Promise.all(fonts.map((font) => document.fonts.load(font))).then(
        () => undefined,
        () => undefined,
    );
}

import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes';
import { WebglAddon } from '@xterm/addon-webgl';
import { type IDisposable, Terminal } from '@xterm/xterm';
import type { TerminalAppearance } from '../../shared/terminal-appearance';
import type { TerminalPalette } from '../ui/themes';
import { attachInput, type InputModes } from './ats-input';
import { AtsSurface, SELECTION_CAP } from './ats-surface';
import { LogicalText } from './buffer-lines';
import { type BufferText, bufferText } from './buffer-text';
import { parseClipboardRequest } from './clipboard-write';
import { CreditTracker } from './credit-tracker';
import { CursorBlink } from './cursor-blink';
import { type FindMatch, type FindOptions, type FindResult, findMatches } from './find';
import { type TerminalLink, TerminalLinks } from './hyperlinks';
import { KittyKeyboard } from './kitty-keyboard';
import type { InputRefusal, TerminalNotice } from './notices';
import { OutputAnnouncer, type OutputSpeech } from './output-announcer';
import { encodePaste, pastedLines } from './paste';
import { registerQueryFilters } from './query-filter';
import { ReviewField } from './review-field';
import { SCROLLBAR_WIDTH, TerminalGeometry } from './terminal-geometry';
import { xtermTheme } from './terminal-theme';
import { UpdateScheduler } from './update-scheduler';
import { reportWriteTiming } from './write-timing';
import { showCursor } from './xterm-cursor';
import '@xterm/xterm/css/xterm.css';
import '../ui/fonts.css';
import styles from './terminal-view.module.css';

/** A terminal's accessible names and texts (A11Y-01.1, A11Y-01.2). */
export interface TerminalLabel {
    /** The terminal's name: session, host and state. */
    readonly name: string;
    /** The shortcut hint that describes it. */
    readonly hint: string;
    /** The text of the indicator on a scrolled-back terminal while new output arrives (A11Y-08.4). */
    readonly outputBelow: string;
    /** Review mode's name (A11Y-03). */
    readonly review: string;
    /** The terminal's name while its host is disconnected (US-1.14.1). */
    readonly disconnected: string;
    /** What a keystroke shows while the host is disconnected (US-1.14.2). */
    readonly inputRefused: string;
    /** What a keystroke shows before the session has attached (US-1.14.2). */
    readonly inputNotReady: string;
}

interface FindState {
    readonly text: BufferText;
    readonly matches: readonly FindMatch[];
    index: number;
}

/** What a terminal view needs from its session. */
export interface TerminalViewOptions {
    /** The terminal colors, apart from the UI's. */
    readonly palette: TerminalPalette;
    readonly isMac: boolean;
    /** Whether assistive technology is active, which slows the ATS cadence (S3a). */
    readonly assistiveTechnology: () => boolean;
    /** Bytes for the process, as text; false when they could not be sent, which the view then reports. */
    readonly onInput: (text: string) => boolean;
    /** Output credit to return to the daemon (D-19). */
    readonly onCredit: (bytes: number) => void;
    /** The terminal's size changed; the PTY follows (US-1.11.3). */
    readonly onResize: (size: { readonly cols: number; readonly rows: number }) => void;
    /** The widest the grid gets; narrower spaces get fewer columns (A11Y-07.5). */
    readonly maxColumns?: number;
    /** Where new output is spoken (A11Y-02); without it, output is not spoken. */
    readonly speech?: OutputSpeech;
    /** The terminal font size in CSS pixels; {@link TERMINAL_FONT_SIZE} without it (A11Y-07.4). */
    readonly fontSize?: number;
    /** Lines of scrollback the terminal keeps; {@link DEFAULT_SCROLLBACK_LINES} without it (NFR-10). */
    readonly scrollback?: number;
    /** The user opened a link with Command+click, or Control+click off macOS (US-1.12.3). */
    readonly onLink?: (link: TerminalLink) => void;
    /** The user pasted more than one line, which waits for a confirmation (US-1.12.2); without it, it is sent. */
    readonly onPasteRequest?: (text: string) => void;
    /** Something to show or announce, such as a copy past the selection cap. */
    readonly onNotice?: (notice: TerminalNotice) => void;
    /** The user asked for the terminal's context menu, with or without a selection to copy (A11Y-11.11). */
    readonly onContextMenu?: (canCopy: boolean) => void;
    /** Whether the host lets programs write the clipboard with OSC 52; off without it (SEC-06.1). */
    readonly clipboardWrites?: () => boolean;
    /** A program wrote text to the clipboard while allowed. */
    readonly onClipboardWrite?: (text: string) => void;
}

/** The terminal font, embedded in the app. */
export const TERMINAL_FONT_FAMILY = '"Intel One Mono", monospace';
/** The terminal font size, in CSS pixels. */
export const TERMINAL_FONT_SIZE = 14;
/** The grid's default maximum width. */
export const DEFAULT_MAX_COLUMNS = 120;
/** The scrollback a terminal keeps unless told otherwise (NFR-10). */
export const DEFAULT_SCROLLBACK_LINES = 10_000;
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
    readonly #outputBelow: HTMLButtonElement;
    readonly #inputRefused: HTMLElement;
    readonly #ats: AtsSurface;
    readonly #scheduler: UpdateScheduler;
    readonly #credit: CreditTracker;
    readonly #measurer: HTMLElement;
    readonly #announcer: OutputAnnouncer | undefined;
    readonly #links: TerminalLinks;
    readonly #blink: CursorBlink;
    #review: ReviewField | undefined;
    #label: TerminalLabel | undefined;
    #connected = true;
    #find: FindState | undefined;
    #wantsBlink = false;
    #reducedMotion = false;
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
            fontSize: options.fontSize ?? TERMINAL_FONT_SIZE,
            scrollback: options.scrollback ?? DEFAULT_SCROLLBACK_LINES,
            cursorStyle: 'block',
            cursorInactiveStyle: 'outline',
            minimumContrastRatio: 4.5,
            screenReaderMode: false,
            macOptionIsMeta: false,
            overviewRuler: { width: SCROLLBAR_WIDTH },
            theme: xtermTheme(options.palette),
        });
        this.surface = createSurface(options.fontSize ?? TERMINAL_FONT_SIZE);
        this.#hint = createHint();
        this.#outputBelow = createOutputBelow();
        this.#inputRefused = createInputRefused();
        this.#measurer = createMeasurer(options.fontSize ?? TERMINAL_FONT_SIZE);
        this.#ats = new AtsSurface(this.terminal, this.surface);
        this.#scheduler = new UpdateScheduler(() => this.#ats.update(), options.assistiveTechnology);
        this.#credit = new CreditTracker(options.onCredit);
        this.#announcer = options.speech === undefined ? undefined : new OutputAnnouncer(this.terminal, options.speech);
        this.#blink = new CursorBlink(this.terminal.options);
        this.#links = new TerminalLinks(
            this.terminal,
            (link) => options.onLink?.(link),
            (event) => this.#linkModifier(event),
        );
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
        host.append(canvas, this.surface, this.#hint, this.#measurer, this.#outputBelow, this.#inputRefused);
        this.#review = new ReviewField(host, () => bufferText(this.terminal), {
            onClose: () => this.toggleReview(),
            onNewOutput: () => this.#options.onNotice?.({ kind: 'review-output' }),
        });
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
        const arrived = performance.now();
        return new Promise((resolve) => {
            this.terminal.write(data, () => {
                this.#credit.parsed(data.length);
                if (__TRC_TEST_SEAM__) {
                    reportWriteTiming(arrived, performance.now(), data.length);
                }
                resolve();
            });
        });
    }

    /** Sets the accessible name (session, host and state) and the shortcut hint (A11Y-01.1, A11Y-01.2). */
    setLabel(label: TerminalLabel): void {
        this.#label = label;
        this.#hint.textContent = label.hint;
        this.#outputBelow.textContent = label.outputBelow;
        this.#showConnection();
    }

    /**
     * Records whether the host is connected. While it is not, input is refused and never buffered: each keystroke
     * shows and reports that it was not sent (US-1.14.2).
     */
    setConnected(connected: boolean): void {
        this.#connected = connected;
        this.#inputRefused.hidden = true;
        this.#showConnection();
    }

    /**
     * Shows and reports that typing was not sent, and why: the host is disconnected or the session is still opening
     * (US-1.14.2). Connecting again, or attaching, clears it.
     */
    refuseInput(reason: InputRefusal): void {
        const label = this.#label;
        if (label !== undefined) {
            this.#inputRefused.textContent = reason === 'opening' ? label.inputNotReady : label.inputRefused;
        }
        this.#inputRefused.hidden = false;
        this.#options.onNotice?.({ kind: 'input-refused', reason });
    }

    /**
     * Starts over for a re-attach: the screen, pending credit, waiting speech and the search are dropped, as the
     * daemon sends the session's screen again (US-1.14.3).
     */
    restart(): void {
        this.#announcer?.restart();
        this.#credit.reset();
        this.endFind();
        this.terminal.reset();
        this.#outputBelow.hidden = true;
        this.#scheduler.request();
    }

    /** Opens review mode on the cursor's line, or closes it and returns to the terminal (A11Y-03.1). */
    toggleReview(): void {
        if (this.#review?.isOpen === true) {
            this.#review.close();
            this.surface.focus();
        } else {
            this.#review?.open(this.#label?.review ?? '');
        }
    }

    /** Whether review mode is open. */
    get reviewOpen(): boolean {
        return this.#review?.isOpen === true;
    }

    /** Finds `query` in the buffer and selects the most recent match (US-1.13, A11Y-03.6). */
    find(query: string, options: FindOptions): FindResult {
        const text = bufferText(this.terminal);
        const matches = findMatches(text.lines, query, options);
        if (matches === 'invalid') {
            this.endFind();
            return 'invalid';
        }
        this.#find = { text, matches, index: matches.length - 1 };
        this.#showMatch();
        return { index: this.#find.index, count: matches.length };
    }

    /** Selects the next or the previous match, wrapping around. */
    findStep(direction: 'next' | 'previous'): FindResult {
        const find = this.#find;
        if (find === undefined || find.matches.length === 0) {
            return { index: -1, count: 0 };
        }
        const step = direction === 'next' ? 1 : -1;
        find.index = (find.index + step + find.matches.length) % find.matches.length;
        this.#showMatch();
        return { index: find.index, count: find.matches.length };
    }

    /** Ends a search and clears its selection. */
    endFind(): void {
        this.#find = undefined;
        this.terminal.clearSelection();
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

    /** Whether the next key goes to the process even if the app reserves it. */
    get passingNextKey(): boolean {
        return this.#modes.sendNextKey;
    }

    /** The links on the screen, for the List links command (US-1.12.3). */
    visibleLinks(): readonly TerminalLink[] {
        return this.#links.visible();
    }

    /** Applies line height, extra letter spacing, the cursor's shape and width, and blinking (A11Y-07.6, A11Y-07.8). */
    setAppearance(appearance: TerminalAppearance): void {
        this.terminal.options.lineHeight = appearance.lineHeight;
        this.terminal.options.cursorStyle = appearance.cursorStyle;
        this.terminal.options.cursorWidth = appearance.cursorWidth;
        this.#wantsBlink = appearance.cursorBlink;
        this.#blink.set({ wanted: this.#wantsBlink, reducedMotion: this.#reducedMotion });
        this.#geometry?.setExtraSpacing(appearance.letterSpacing);
    }

    /** Names the help and leave-terminal shortcuts in the terminal's description, or not when hints are off (A11Y-01.2). */
    setHints(on: boolean): void {
        if (on) {
            this.surface.setAttribute('aria-describedby', this.#hint.id);
        } else {
            this.surface.removeAttribute('aria-describedby');
        }
    }

    /** Keeps at least `ratio` contrast between each cell's text and background (A11Y-04, A11Y-10.3). */
    setMinimumContrast(ratio: number): void {
        this.terminal.options.minimumContrastRatio = ratio;
    }

    /** Stops the cursor blinking while the OS reduces motion (A11Y-08.1). */
    setReducedMotion(reducedMotion: boolean): void {
        this.#reducedMotion = reducedMotion;
        this.#blink.set({ wanted: this.#wantsBlink, reducedMotion });
    }

    /** Changes the terminal font size; the grid refits and the PTY follows (A11Y-07.4, US-1.11.3). */
    setFontSize(size: number): void {
        this.terminal.options.fontSize = size;
        this.surface.style.fontSize = `${size}px`;
        this.#measurer.style.fontSize = `${size}px`;
        this.#geometry?.fit();
    }

    /** Sends pasted text to the process, as bracketed paste when the program asked for it (US-1.12.2). */
    paste(text: string): void {
        this.#send(encodePaste(text, this.terminal.modes.bracketedPasteMode));
    }

    /** Moves keyboard focus to the surface, or to review mode while it is open. */
    focus(): void {
        if (this.#review?.isOpen === true) {
            this.#review.focus();
        } else {
            this.surface.focus();
        }
    }

    /** Releases the terminal and its listeners. */
    dispose(): void {
        this.#disposed = true;
        this.#scheduler.dispose();
        this.#announcer?.dispose();
        this.#review?.close();
        this.#blink.dispose();
        this.#links.dispose();
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
        showCursor(this.terminal);
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
        const keyboard = new KittyKeyboard(this.terminal);
        const disposables: IDisposable[] = [
            ...registerQueryFilters(this.terminal),
            this.terminal.parser.registerOscHandler(52, (data) => this.#clipboardRequest(data)),
            keyboard,
            this.terminal.onWriteParsed(() => {
                this.#syncPointerMode();
                this.#noticeOutputBelow();
                this.#review?.output();
                request();
            }),
            this.terminal.onScroll(() => {
                this.#clearOutputBelow();
                request();
            }),
            this.terminal.onBell(() => this.#options.onNotice?.({ kind: 'bell' })),
            this.terminal.onSelectionChange(request),
            this.terminal.onResize(({ cols, rows }) => {
                this.#geometry?.align();
                this.#options.onResize({ cols, rows });
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
                {
                    element: this.surface,
                    terminal: this.terminal,
                    modes: this.#modes,
                    isMac: this.#options.isMac,
                    keyboardFlags: () => keyboard.flags,
                },
                this.#inputSink(),
            ),
        );
        this.#listenFocus(request);
        this.#listenWheel();
        this.#listenInterrupt();
        this.#listenLinks();
        this.#listenClipboard();
        this.#listenOutputBelow();
    }

    #listenClipboard(): void {
        const onCopy = (event: ClipboardEvent): void => {
            const position = this.terminal.getSelectionPosition();
            if (position === undefined || event.clipboardData === null) {
                return;
            }
            event.preventDefault();
            event.clipboardData.setData('text/plain', this.terminal.getSelection());
            const lines = position.end.y - position.start.y + 1;
            if (lines > SELECTION_CAP) {
                this.#options.onNotice?.({ kind: 'copy-capped', lines });
            }
        };
        const onContextMenu = (event: Event): void => {
            event.preventDefault();
            this.#options.onContextMenu?.(this.terminal.hasSelection());
        };
        const onMenuKey = (event: KeyboardEvent): void => {
            if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
                event.stopImmediatePropagation();
                onContextMenu(event);
            }
        };
        this.surface.addEventListener('copy', onCopy);
        this.surface.addEventListener('cut', onCopy);
        this.surface.addEventListener('contextmenu', onContextMenu);
        this.surface.addEventListener('keydown', onMenuKey, { capture: true });
        this.#cleanups.push(() => {
            this.surface.removeEventListener('copy', onCopy);
            this.surface.removeEventListener('cut', onCopy);
            this.surface.removeEventListener('contextmenu', onContextMenu);
            this.surface.removeEventListener('keydown', onMenuKey, { capture: true });
        });
    }

    #listenLinks(): void {
        const linkAt = (event: MouseEvent): TerminalLink | undefined => {
            const cell = this.#linkModifier(event) ? this.#ats.cellAt(event.clientX, event.clientY) : undefined;
            return cell === undefined ? undefined : this.#links.linkAt(cell.row, cell.column);
        };
        const onPress = (event: MouseEvent): void => {
            if (linkAt(event) !== undefined) {
                event.preventDefault();
            }
        };
        const onClick = (event: MouseEvent): void => {
            const link = linkAt(event);
            if (link !== undefined) {
                event.preventDefault();
                this.#options.onLink?.(link);
            }
        };
        const onMove = (event: MouseEvent): void => {
            this.surface.style.cursor = linkAt(event) === undefined ? '' : 'pointer';
        };
        const listeners = [
            ['mousedown', onPress],
            ['click', onClick],
            ['mousemove', onMove],
        ] as const;
        for (const [type, listener] of listeners) {
            this.surface.addEventListener(type, listener);
        }
        this.#cleanups.push(() => {
            for (const [type, listener] of listeners) {
                this.surface.removeEventListener(type, listener);
            }
        });
    }

    #linkModifier(event: MouseEvent): boolean {
        return this.#options.isMac ? event.metaKey : event.ctrlKey;
    }

    #listenInterrupt(): void {
        const interrupt = (): void => this.#announcer?.interrupt();
        this.surface.addEventListener('keydown', interrupt, { capture: true });
        this.#cleanups.push(() => this.surface.removeEventListener('keydown', interrupt, { capture: true }));
    }

    #clipboardRequest(data: string): boolean {
        const request = parseClipboardRequest(data);
        if (request?.kind === 'write' && this.#options.clipboardWrites?.() === true) {
            this.#options.onClipboardWrite?.(request.text);
        }
        return true;
    }

    #showMatch(): void {
        const find = this.#find;
        const match = find?.matches[find.index];
        if (find === undefined || match === undefined) {
            this.terminal.clearSelection();
            return;
        }
        if (this.#review?.isOpen === true) {
            this.#review.select(match.line, match.start, match.end);
            return;
        }
        const buffer = this.terminal.buffer.active;
        const line = new LogicalText(buffer, find.text.firstRows[match.line] ?? 0, this.terminal.cols);
        const start = line.cellOf(match.start);
        const last = line.cellOf(match.end - 1);
        const length = (last.row - start.row) * this.terminal.cols + last.column - start.column + 1;
        this.terminal.select(start.column, start.row, length);
        this.terminal.scrollToLine(Math.max(0, start.row - Math.floor(this.terminal.rows / 2)));
    }

    #showConnection(): void {
        const label = this.#label;
        if (label !== undefined) {
            this.surface.setAttribute('aria-label', this.#connected ? label.name : label.disconnected);
        }
        if (this.#connected) {
            this.#inputRefused.hidden = true;
        }
    }

    #noticeOutputBelow(): void {
        const buffer = this.terminal.buffer.active;
        if (buffer.viewportY < buffer.baseY && this.#outputBelow.hidden) {
            this.#outputBelow.hidden = false;
            this.#options.onNotice?.({ kind: 'output-below' });
        }
    }

    #clearOutputBelow(): void {
        const buffer = this.terminal.buffer.active;
        if (buffer.viewportY >= buffer.baseY) {
            this.#outputBelow.hidden = true;
        }
    }

    #syncPointerMode(): void {
        this.surface.dataset['mouse'] = this.terminal.modes.mouseTrackingMode === 'none' ? 'off' : 'on';
    }

    #forwardTerminalData(data: string): void {
        if (data !== FOCUS_IN && data !== FOCUS_OUT) {
            this.#deliver(data);
        }
    }

    #deliver(text: string): void {
        if (this.#connected) {
            this.#options.onInput(text);
        }
    }

    #send(text: string): void {
        if (!this.#connected) {
            this.refuseInput('disconnected');
            return;
        }
        if (!this.#options.onInput(text)) {
            this.refuseInput('opening');
            return;
        }
        this.#scheduler.input();
        this.#blink.input();
        this.#announcer?.input(text);
        this.terminal.clearSelection();
        this.terminal.scrollToBottom();
        this.#ats.placeCaret();
    }

    #inputSink() {
        return {
            send: (text: string): void => this.#send(text),
            paste: (text: string): void => {
                const confirm = this.#options.onPasteRequest;
                if (confirm !== undefined && pastedLines(text) > 1) {
                    confirm(text);
                } else {
                    this.paste(text);
                }
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
                this.#deliver(FOCUS_IN);
            }
            request();
        };
        const onBlur = (): void => {
            this.terminal.options.cursorInactiveStyle = 'outline';
            if (this.terminal.modes.sendFocusMode) {
                this.#deliver(FOCUS_OUT);
            }
        };
        this.surface.addEventListener('focus', onFocus);
        this.surface.addEventListener('blur', onBlur);
        this.#cleanups.push(() => {
            this.surface.removeEventListener('focus', onFocus);
            this.surface.removeEventListener('blur', onBlur);
        });
    }

    #listenOutputBelow(): void {
        const jump = (): void => {
            this.terminal.scrollToBottom();
            this.focus();
        };
        this.#outputBelow.addEventListener('click', jump);
        this.#cleanups.push(() => this.#outputBelow.removeEventListener('click', jump));
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

function createSurface(fontSize: number): HTMLElement {
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
    surface.style.fontSize = `${fontSize}px`;
    return surface;
}

function createHint(): HTMLElement {
    hintCounter += 1;
    const hint = document.createElement('span');
    hint.id = `trc-terminal-hint-${hintCounter}`;
    hint.hidden = true;
    return hint;
}

function createOutputBelow(): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.tabIndex = -1;
    button.hidden = true;
    button.dataset['outputBelow'] = '';
    button.className = styles['outputBelow'] ?? '';
    return button;
}

function createInputRefused(): HTMLElement {
    const notice = document.createElement('p');
    notice.hidden = true;
    notice.dataset['inputRefused'] = '';
    notice.className = styles['inputRefused'] ?? '';
    return notice;
}

function createMeasurer(fontSize: number): HTMLElement {
    const measurer = document.createElement('span');
    measurer.className = styles['measurer'] ?? '';
    measurer.setAttribute('aria-hidden', 'true');
    measurer.style.fontFamily = TERMINAL_FONT_FAMILY;
    measurer.style.fontSize = `${fontSize}px`;
    return measurer;
}

function loadTerminalFonts(): Promise<void> {
    const fonts = [`${TERMINAL_FONT_SIZE}px "Intel One Mono"`, `italic ${TERMINAL_FONT_SIZE}px "Intel One Mono"`];
    return Promise.all(fonts.map((font) => document.fonts.load(font))).then(
        () => undefined,
        () => undefined,
    );
}

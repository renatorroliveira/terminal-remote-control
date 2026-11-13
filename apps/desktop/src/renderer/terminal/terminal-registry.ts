import type { SessionInfo } from '@trc/protocol';
import type { SessionKey, SessionOptions, TerminalHost } from '../sessions/workspace-controller';
import type { TerminalPalette } from '../ui/themes';
import type { TerminalLink } from './hyperlinks';
import type { TerminalNotice } from './notices';
import type { OutputSpeech } from './output-announcer';
import { SessionLink, type SessionTransport } from './session-link';
import styles from './terminal-registry.module.css';
import { TerminalView } from './terminal-view';

/** A terminal's accessible name and shortcut hint (A11Y-01.1, A11Y-01.2). */
export interface TerminalLabel {
    readonly name: string;
    readonly hint: string;
}

/** How sessions' output is spoken (A11Y-02); the registry adds that only the open session speaks. */
export interface SessionSpeech {
    /** Whether a session's output may be spoken: screen-reader mode is on and the user has not muted it. */
    allowed(key: SessionKey): boolean;
    speak(key: SessionKey, text: string): void;
    /** Drops a session's output speech still waiting to go. */
    cancel(key: SessionKey): void;
    /** Lines a second above which output is summarized (A11Y-02.3). */
    floodThreshold(): number;
    /** The summary of a flood of `lines` lines. */
    summary(lines: number): string;
}

/** What the registry needs to build terminals. */
export interface TerminalRegistryOptions {
    readonly transport: SessionTransport;
    readonly isMac: boolean;
    readonly assistiveTechnology: () => boolean;
    readonly palette: TerminalPalette;
    readonly labelFor: (hostId: string, session: SessionInfo) => TerminalLabel;
    /** Output arrived for a session, open or not (US-1.8.3). */
    readonly onActivity?: (key: SessionKey) => void;
    /** Where the open session's output is spoken; without it, no output is spoken. */
    readonly speech?: SessionSpeech;
    /** The user opened a link in a terminal (US-1.12.3). */
    readonly onOpenLink?: (link: TerminalLink) => void;
    /** The user pasted more than one line into a session (US-1.12.2). */
    readonly onPasteRequest?: (key: SessionKey, text: string) => void;
    /** A session's terminal reported something to show or announce. */
    readonly onNotice?: (key: SessionKey, notice: TerminalNotice) => void;
    /** The user asked for a terminal's context menu (A11Y-11.11). */
    readonly onContextMenu?: (canCopy: boolean) => void;
    /** Whether a host lets programs write the clipboard with OSC 52 (SEC-06.1). */
    readonly clipboardWrites?: (hostId: string) => boolean;
    /** A program in a session wrote the clipboard while its host allowed it. */
    readonly onClipboardWrite?: (key: SessionKey, text: string) => void;
}

interface Entry {
    readonly frame: HTMLElement;
    readonly view: TerminalView;
    readonly link: SessionLink;
}

/**
 * Every open session's terminal, outside React (TECH_STACK §4.3). Each has its own frame in the terminal area; only
 * the open one is visible. Hidden ones keep their layout size, so they keep their grid, scrollback and scroll
 * position (US-1.8.3), and assistive technology does not see them.
 */
export class TerminalRegistry implements TerminalHost {
    readonly #options: TerminalRegistryOptions;
    readonly #entries = new Map<SessionKey, Entry>();
    #area: HTMLElement | undefined;
    #palette: TerminalPalette;
    #open: SessionKey | undefined;
    #tabFocusMode = false;

    /** Creates an empty registry. */
    constructor(options: TerminalRegistryOptions) {
        this.#options = options;
        this.#palette = options.palette;
    }

    /** Sets the element terminals are shown in; their frames move with it. The same element again changes nothing. */
    attach(area: HTMLElement | null): void {
        if ((area ?? undefined) === this.#area) {
            return;
        }
        this.#area = area ?? undefined;
        for (const entry of this.#entries.values()) {
            this.#area?.append(entry.frame);
        }
    }

    /** Shows a session's terminal, attaching it the first time, and focuses it. */
    show(key: SessionKey, hostId: string, session: SessionInfo): void {
        const entry = this.#entries.get(key) ?? this.#attachNew(key, hostId, session);
        for (const other of this.#entries.values()) {
            other.frame.hidden = other !== entry;
        }
        const label = this.#options.labelFor(hostId, session);
        entry.view.setLabel(label.name, label.hint);
        if (this.#open !== undefined && this.#open !== key) {
            this.#options.speech?.cancel(this.#open);
        }
        this.#open = key;
        entry.view.focus();
    }

    /** Focuses the open terminal; false when no session is open. */
    focusOpen(): boolean {
        const entry = this.#openEntry();
        entry?.view.focus();
        return entry !== undefined;
    }

    /** Makes Tab and Shift+Tab move focus out of every terminal instead of reaching the process (A11Y-05.4). */
    setTabFocusMode(on: boolean): void {
        this.#tabFocusMode = on;
        for (const entry of this.#entries.values()) {
            entry.view.setTabFocusMode(on);
        }
    }

    /** Sends the next key to the open terminal's process, even an app shortcut, and focuses it (A11Y-05.3). */
    sendNextKey(): boolean {
        const entry = this.#openEntry();
        entry?.view.sendNextKey();
        entry?.view.focus();
        return entry !== undefined;
    }

    /** Whether the open terminal waits for a key to pass to its process. */
    passingNextKey(): boolean {
        return this.#openEntry()?.view.passingNextKey ?? false;
    }

    /** Pastes text into a session's terminal and focuses it (US-1.12.2). */
    paste(key: SessionKey, text: string): void {
        const entry = this.#entries.get(key);
        entry?.view.paste(text);
        entry?.view.focus();
    }

    /** The links on the open terminal's screen (US-1.12.3). */
    visibleLinks(): readonly TerminalLink[] {
        return this.#openEntry()?.view.visibleLinks() ?? [];
    }

    /** Creates a session on `hostId` at the terminal area's size, with the options given, in a frame of its own. */
    async create(hostId: string, options: SessionOptions = {}): Promise<SessionInfo> {
        const entry = this.#newEntry(hostId);
        await entry.view.ready;
        const session = await entry.link.create({ ...options, env: options.env ?? {} }).catch((error: unknown) => {
            this.#dispose(entry);
            throw error;
        });
        this.#entries.set(`${hostId}/${session.id}`, entry);
        return session;
    }

    /** Detaches and removes the terminals of a host whose connection closed. */
    closeHost(hostId: string): void {
        for (const [key, entry] of this.#entries) {
            if (key.startsWith(`${hostId}/`)) {
                this.#dispose(entry);
                this.#entries.delete(key);
                this.#open = this.#open === key ? undefined : this.#open;
            }
        }
    }

    /** Removes the terminal of a session the daemon closed. */
    closeSession(key: SessionKey): void {
        const entry = this.#entries.get(key);
        if (entry !== undefined) {
            this.#dispose(entry);
            this.#entries.delete(key);
            this.#open = this.#open === key ? undefined : this.#open;
        }
    }

    /** Applies a theme's terminal colors to every terminal. */
    setPalette(palette: TerminalPalette): void {
        this.#palette = palette;
        for (const entry of this.#entries.values()) {
            entry.view.setPalette(palette);
        }
    }

    /** Detaches and removes every terminal. */
    dispose(): void {
        for (const entry of this.#entries.values()) {
            this.#dispose(entry);
        }
        this.#entries.clear();
    }

    #activity(link: SessionLink): void {
        const key = this.#keyOf(link);
        if (key !== undefined) {
            this.#options.onActivity?.(key);
        }
    }

    #keyOf(link: SessionLink): SessionKey | undefined {
        for (const [key, entry] of this.#entries) {
            if (entry.link === link) {
                return key;
            }
        }
        return undefined;
    }

    #speechFor(link: () => SessionLink): OutputSpeech | undefined {
        const speech = this.#options.speech;
        if (speech === undefined) {
            return undefined;
        }
        const key = (): SessionKey | undefined => this.#keyOf(link());
        return {
            enabled: () => {
                const open = key();
                return open !== undefined && open === this.#open && speech.allowed(open);
            },
            speak: (text) => withKey(key(), (found) => speech.speak(found, text)),
            cancel: () => withKey(key(), (found) => speech.cancel(found)),
            floodThreshold: () => speech.floodThreshold(),
            summary: (lines) => speech.summary(lines),
        };
    }

    #openEntry(): Entry | undefined {
        return this.#open === undefined ? undefined : this.#entries.get(this.#open);
    }

    #attachNew(key: SessionKey, hostId: string, session: SessionInfo): Entry {
        const entry = this.#newEntry(hostId);
        this.#entries.set(key, entry);
        void entry.view.ready.then(() => entry.link.attach(session.id)).catch(() => undefined);
        return entry;
    }

    #newEntry(hostId: string): Entry {
        const frame = document.createElement('div');
        frame.className = styles['frame'] ?? '';
        this.#area?.append(frame);
        let view: TerminalView | undefined;
        const link = new SessionLink(this.#options.transport, hostId, (data) => {
            void view?.write(data);
            this.#activity(link);
        });
        const speech = this.#speechFor(() => link);
        view = new TerminalView({
            palette: this.#palette,
            isMac: this.#options.isMac,
            assistiveTechnology: this.#options.assistiveTechnology,
            onInput: (text) => link.input(text),
            onCredit: (bytes) => link.credit(bytes),
            onResize: (size) => link.resize(size),
            ...(speech === undefined ? {} : { speech }),
            onLink: (link) => this.#options.onOpenLink?.(link),
            onContextMenu: (canCopy) => this.#options.onContextMenu?.(canCopy),
            onPasteRequest: (text) => withKey(this.#keyOf(link), (key) => this.#options.onPasteRequest?.(key, text)),
            onNotice: (notice) => withKey(this.#keyOf(link), (key) => this.#options.onNotice?.(key, notice)),
            clipboardWrites: () => this.#options.clipboardWrites?.(hostId) === true,
            onClipboardWrite: (text) =>
                withKey(this.#keyOf(link), (key) => this.#options.onClipboardWrite?.(key, text)),
        });
        view.mount(frame);
        view.setTabFocusMode(this.#tabFocusMode);
        return { frame, view, link };
    }

    #dispose(entry: Entry): void {
        entry.link.dispose();
        entry.view.dispose();
        entry.frame.remove();
    }
}

function withKey(key: SessionKey | undefined, run: (key: SessionKey) => void): void {
    if (key !== undefined) {
        run(key);
    }
}

import type { SessionInfo } from '@trc/protocol';
import { DEFAULT_TERMINAL_APPEARANCE, type TerminalAppearance } from '../../shared/terminal-appearance';
import type { AttachFailure, SessionKey, SessionOptions, TerminalHost } from '../sessions/workspace-controller';
import type { TerminalPalette } from '../ui/themes';
import type { FindOptions, FindResult } from './find';
import type { TerminalLink } from './hyperlinks';
import type { TerminalNotice } from './notices';
import type { OutputSpeech } from './output-announcer';
import { SessionLink, type SessionTransport } from './session-link';
import styles from './terminal-registry.module.css';
import { DEFAULT_SCROLLBACK_LINES, TERMINAL_FONT_SIZE, type TerminalLabel, TerminalView } from './terminal-view';

/** A terminal's accessible names and texts. */
export type { TerminalLabel } from './terminal-view';

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
    /** A session shown for the first time could not attach; its terminal is gone (US-1.14.2, WCAG 3.3.1). */
    readonly onAttachFailed?: (key: SessionKey, error: unknown) => void;
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
    /** Hosts whose connection is lost, whose terminals refuse input (US-1.14.2). */
    readonly #offline = new Set<string>();
    /** Each host's creates in flight, which a `show` of a session not yet known waits for. */
    readonly #creating = new Map<string, Set<Promise<unknown>>>();
    readonly #stopInputRefused: () => void;
    #area: HTMLElement | undefined;
    #palette: TerminalPalette;
    #open: SessionKey | undefined;
    /** The session last asked for, so a show that waited for a create never overrides a newer one. */
    #wanted: SessionKey | undefined;
    #tabFocusMode = false;
    #fontSize = TERMINAL_FONT_SIZE;
    #appearance: TerminalAppearance = DEFAULT_TERMINAL_APPEARANCE;
    #reducedMotion = false;
    #hints = true;
    #minimumContrast = 4.5;
    #scrollback = DEFAULT_SCROLLBACK_LINES;

    /** Creates an empty registry. */
    constructor(options: TerminalRegistryOptions) {
        this.#options = options;
        this.#palette = options.palette;
        this.#stopInputRefused = options.transport.onInputRefused((hostId) => this.#inputRefused(hostId));
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

    /**
     * Shows a session's terminal, attaching it the first time, and focuses it. One not yet known while a create on its
     * host is in flight waits for it, and is shown then only if no other session was asked for meanwhile.
     */
    show(key: SessionKey, hostId: string, session: SessionInfo): void {
        this.#wanted = key;
        const creating = this.#creating.get(hostId);
        if (!this.#entries.has(key) && creating !== undefined) {
            void Promise.allSettled([...creating]).then(() => this.#showIfWanted(key, hostId, session));
            return;
        }
        const entry = this.#entries.get(key) ?? this.#attachNew(key, hostId, session);
        for (const other of this.#entries.values()) {
            other.frame.hidden = other !== entry;
        }
        const label = this.#options.labelFor(hostId, session);
        entry.view.setLabel(label);
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

    /** Opens or closes the open terminal's review mode; false when no session is open (A11Y-03.1). */
    toggleReview(): boolean {
        const entry = this.#openEntry();
        entry?.view.toggleReview();
        return entry !== undefined;
    }

    /** Searches the open terminal; undefined when no session is open (US-1.13). */
    find(query: string, options: FindOptions): FindResult | undefined {
        return this.#openEntry()?.view.find(query, options);
    }

    /** Selects the open terminal's next or previous match. */
    findStep(direction: 'next' | 'previous'): FindResult | undefined {
        return this.#openEntry()?.view.findStep(direction);
    }

    /** Ends the open terminal's search. */
    endFind(): void {
        this.#openEntry()?.view.endFind();
    }

    /** Sets every terminal's text size, in percent of the default (A11Y-07.4). */
    setZoom(zoom: number): void {
        this.#fontSize = Math.round((TERMINAL_FONT_SIZE * zoom) / 100);
        for (const entry of this.#entries.values()) {
            entry.view.setFontSize(this.#fontSize);
        }
    }

    /** Sets every terminal's line height, letter spacing and cursor (A11Y-07.6, A11Y-07.8). */
    setAppearance(appearance: TerminalAppearance): void {
        this.#appearance = appearance;
        for (const entry of this.#entries.values()) {
            entry.view.setAppearance(appearance);
        }
    }

    /** Stops every cursor blinking while the OS reduces motion (A11Y-08.1). */
    setReducedMotion(reducedMotion: boolean): void {
        this.#reducedMotion = reducedMotion;
        for (const entry of this.#entries.values()) {
            entry.view.setReducedMotion(reducedMotion);
        }
    }

    /** Shows or drops every terminal's shortcut hint (A11Y-01.2). */
    setHints(on: boolean): void {
        this.#hints = on;
        for (const entry of this.#entries.values()) {
            entry.view.setHints(on);
        }
    }

    /** Sets the contrast every terminal keeps between text and background (A11Y-04, A11Y-10.3). */
    setMinimumContrast(ratio: number): void {
        this.#minimumContrast = ratio;
        for (const entry of this.#entries.values()) {
            entry.view.setMinimumContrast(ratio);
        }
    }

    /** Sets the scrollback of terminals and sessions created from now on (NFR-10, US-1.11.4). */
    setScrollback(lines: number): void {
        this.#scrollback = lines;
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

    /**
     * Creates a session on `hostId` at the terminal area's size, with the options given, in a hidden frame of its own
     * that `show` reveals. A session shown while a create on its host is in flight waits for it, so the daemon's
     * announcement of the new session never builds a second terminal for it.
     */
    create(hostId: string, options: SessionOptions = {}): Promise<SessionInfo> {
        const creating = this.#creating.get(hostId) ?? new Set<Promise<unknown>>();
        this.#creating.set(hostId, creating);
        const tracked: Promise<SessionInfo> = this.#create(hostId, options).finally(() => {
            creating.delete(tracked);
            if (creating.size === 0) {
                this.#creating.delete(hostId);
            }
        });
        creating.add(tracked);
        return tracked;
    }

    /** Lets a host's terminals send input again, or refuses it while the host is disconnected (US-1.14.2). */
    setHostConnected(hostId: string, connected: boolean): void {
        if (connected) {
            this.#offline.delete(hostId);
        } else {
            this.#offline.add(hostId);
        }
        for (const entry of this.#entriesOf(hostId)) {
            entry.view.setConnected(connected);
        }
    }

    /**
     * Attaches a reconnected host's terminals to their sessions again, each on a fresh screen (US-1.14.3). Each keeps
     * refusing typing until its attach answers (US-1.14.2); returns the sessions that could not attach, whose terminals
     * are removed.
     */
    async reattachHost(hostId: string): Promise<readonly AttachFailure[]> {
        this.#offline.delete(hostId);
        const keys = [...this.#entries.keys()].filter((key) => key.startsWith(`${hostId}/`));
        const failed = await Promise.all(keys.map((key) => this.#reattach(key)));
        return failed.filter((failure): failure is AttachFailure => failure !== undefined);
    }

    /** Detaches and removes the terminals of a host whose connection closed. */
    closeHost(hostId: string): void {
        for (const key of this.#entries.keys()) {
            if (key.startsWith(`${hostId}/`)) {
                this.closeSession(key);
            }
        }
    }

    /** Removes the terminal of a session the daemon closed. */
    closeSession(key: SessionKey): void {
        const entry = this.#entries.get(key);
        if (entry !== undefined) {
            this.#remove(key, entry);
        }
    }

    /** Applies a theme's terminal colors to every terminal. */
    setPalette(palette: TerminalPalette): void {
        this.#palette = palette;
        for (const entry of this.#entries.values()) {
            entry.view.setPalette(palette);
        }
    }

    /** Detaches and removes every terminal, and stops listening to the connection. */
    dispose(): void {
        this.#stopInputRefused();
        for (const entry of this.#entries.values()) {
            this.#dispose(entry);
        }
        this.#entries.clear();
    }

    #showIfWanted(key: SessionKey, hostId: string, session: SessionInfo): void {
        if (this.#wanted === key) {
            this.show(key, hostId, session);
        }
    }

    #inputRefused(hostId: string): void {
        if (this.#open?.startsWith(`${hostId}/`) === true) {
            this.#openEntry()?.view.refuseInput();
        }
    }

    async #reattach(key: SessionKey): Promise<AttachFailure | undefined> {
        const entry = this.#entries.get(key);
        if (entry === undefined) {
            return undefined;
        }
        entry.view.restart();
        try {
            await entry.link.reattach();
            entry.view.setConnected(true);
            return undefined;
        } catch (error) {
            this.#removeIfCurrent(key, entry);
            return { key, error };
        }
    }

    #attachFailed(key: SessionKey, entry: Entry, error: unknown): void {
        if (this.#removeIfCurrent(key, entry)) {
            this.#options.onAttachFailed?.(key, error);
        }
    }

    #removeIfCurrent(key: SessionKey, entry: Entry): boolean {
        const current = this.#entries.get(key) === entry;
        if (current) {
            this.#remove(key, entry);
        }
        return current;
    }

    #remove(key: SessionKey, entry: Entry): void {
        this.#dispose(entry);
        this.#entries.delete(key);
        this.#open = this.#open === key ? undefined : this.#open;
    }

    #entriesOf(hostId: string): readonly Entry[] {
        return [...this.#entries].filter(([key]) => key.startsWith(`${hostId}/`)).map(([, entry]) => entry);
    }

    #activity(link: SessionLink): void {
        const key = this.#keyOf(link);
        if (key !== undefined) {
            this.#options.onActivity?.(key);
        }
    }

    async #create(hostId: string, options: SessionOptions): Promise<SessionInfo> {
        const entry = this.#newEntry(hostId);
        await entry.view.ready;
        const spec = { ...options, env: options.env ?? {}, scrollbackLines: this.#scrollback };
        const session = await entry.link.create(spec).catch((error: unknown) => {
            this.#dispose(entry);
            throw error;
        });
        this.#entries.set(`${hostId}/${session.id}`, entry);
        return session;
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
        void entry.view.ready
            .then(() => entry.link.attach(session.id))
            .catch((error: unknown) => this.#attachFailed(key, entry, error));
        return entry;
    }

    #newEntry(hostId: string): Entry {
        const frame = document.createElement('div');
        frame.className = styles['frame'] ?? '';
        frame.hidden = true;
        this.#area?.append(frame);
        let view: TerminalView | undefined;
        const link = new SessionLink(this.#options.transport, hostId, (data) => {
            void view?.write(data);
            this.#activity(link);
        });
        const speech = this.#speechFor(() => link);
        view = new TerminalView({
            palette: this.#palette,
            fontSize: this.#fontSize,
            scrollback: this.#scrollback,
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
        view.setConnected(!this.#offline.has(hostId));
        view.setHints(this.#hints);
        view.setMinimumContrast(this.#minimumContrast);
        view.setTabFocusMode(this.#tabFocusMode);
        view.setReducedMotion(this.#reducedMotion);
        const appearance = this.#appearance;
        void view.ready.then(() => view.setAppearance(appearance));
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

/** How urgently a message is spoken: politely after current speech, or assertively at once (A11Y-12.1). */
export type Politeness = 'polite' | 'assertive';

/** Where announcements are spoken. */
export interface AnnouncementSink {
    speak(text: string, politeness: Politeness): void;
}

/** How an announcement is queued. */
export interface AnnounceOptions {
    readonly politeness?: Politeness;
    /** A burst in one group, such as one host or one session, merges to its latest message (A11Y-12.3). */
    readonly group?: string;
}

/** The time source the announcer paces itself by. */
export interface AnnouncerClock {
    now(): number;
    schedule(run: () => void, delayMs: number): void;
}

/** The shortest gap between two announcements. */
const SPACING_MS = 500;

interface Pending {
    readonly text: string;
    readonly politeness: Politeness;
    readonly group: string;
}

/**
 * Speaks status messages without moving focus (A11Y-12.1): at most one every 500 ms, assertive ones first, and a
 * burst in one group merged to its latest message, so connection steps and state changes never flood speech
 * (A11Y-12.3).
 */
export class Announcer {
    readonly #sink: AnnouncementSink;
    readonly #clock: AnnouncerClock;
    #pending: Pending[] = [];
    #lastSpoken = Number.NEGATIVE_INFINITY;
    #scheduled = false;
    #anonymous = 0;

    /** Creates an announcer that speaks into `sink`. */
    constructor(sink: AnnouncementSink, clock: AnnouncerClock = SYSTEM_CLOCK) {
        this.#sink = sink;
        this.#clock = clock;
    }

    /** Queues a message; a newer message in the same group replaces one still waiting. */
    announce(text: string, options: AnnounceOptions = {}): void {
        const group = options.group ?? `message-${this.#anonymous++}`;
        const message: Pending = { text, politeness: options.politeness ?? 'polite', group };
        const others = this.#pending.filter((pending) => pending.group !== group);
        this.#pending = message.politeness === 'assertive' ? [message, ...others] : [...others, message];
        this.#flush();
    }

    #flush(): void {
        const wait = this.#lastSpoken + SPACING_MS - this.#clock.now();
        if (wait > 0) {
            this.#scheduleFlush(wait);
            return;
        }
        const next = this.#pending.shift();
        if (next === undefined) {
            return;
        }
        this.#lastSpoken = this.#clock.now();
        this.#sink.speak(next.text, next.politeness);
        if (this.#pending.length > 0) {
            this.#scheduleFlush(SPACING_MS);
        }
    }

    #scheduleFlush(delayMs: number): void {
        if (this.#scheduled) {
            return;
        }
        this.#scheduled = true;
        this.#clock.schedule(() => {
            this.#scheduled = false;
            this.#flush();
        }, delayMs);
    }
}

/** Whether the sink may use `ariaNotify`. */
export interface LiveRegionOptions {
    readonly useAriaNotify: boolean;
}

/**
 * Speaks through `document.ariaNotify` where Chromium has it, and otherwise through a polite and an assertive live
 * region, hidden from view, that it adds to `host`. A repeated message gets a different trailing no-break space, so
 * the live region reports it again.
 */
export class LiveRegionSink implements AnnouncementSink {
    readonly #regions: Readonly<Record<Politeness, HTMLElement>>;
    readonly #useAriaNotify: boolean;

    /** Adds the live regions to `host`. */
    constructor(host: HTMLElement, options: LiveRegionOptions = { useAriaNotify: hasAriaNotify(host.ownerDocument) }) {
        this.#useAriaNotify = options.useAriaNotify;
        this.#regions = { polite: liveRegion(host, 'polite'), assertive: liveRegion(host, 'assertive') };
    }

    /** Speaks `text`. */
    speak(text: string, politeness: Politeness): void {
        const document = this.#regions.polite.ownerDocument as AriaNotifyDocument;
        if (this.#useAriaNotify && document.ariaNotify !== undefined) {
            document.ariaNotify(text, { priority: politeness === 'assertive' ? 'high' : 'normal' });
            return;
        }
        const region = this.#regions[politeness];
        region.textContent = region.textContent === text ? `${text}\u00a0` : text;
    }
}

interface AriaNotifyDocument extends Document {
    ariaNotify?: (announcement: string, options: { readonly priority: 'normal' | 'high' }) => void;
}

const SYSTEM_CLOCK: AnnouncerClock = {
    now: () => performance.now(),
    schedule: (run, delayMs) => {
        setTimeout(run, delayMs);
    },
};

function hasAriaNotify(document: Document): boolean {
    return typeof (document as AriaNotifyDocument).ariaNotify === 'function';
}

function liveRegion(host: HTMLElement, politeness: Politeness): HTMLElement {
    const region = host.ownerDocument.createElement('div');
    region.setAttribute('aria-live', politeness);
    region.setAttribute('aria-atomic', 'true');
    region.className = 'trc-visually-hidden';
    host.append(region);
    return region;
}

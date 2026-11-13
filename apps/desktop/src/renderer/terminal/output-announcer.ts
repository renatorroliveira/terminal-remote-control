import type { IDisposable, Terminal } from '@xterm/xterm';
import { EchoFilter } from './echo-filter';
import { FloodControl } from './flood-control';
import { OutputReader } from './output-reader';

/** Where a session's output is spoken, and whether it may be now. */
export interface OutputSpeech {
    /** Whether the output may be spoken now: the session is open, unmuted, and screen-reader mode is on. */
    readonly enabled: () => boolean;
    readonly speak: (text: string) => void;
    /** Drops output speech still waiting to go (A11Y-02.6). */
    readonly cancel: () => void;
    /** Lines a second above which output is summarized (A11Y-02.3). */
    readonly floodThreshold: () => number;
    /** The summary of a flood of `lines` lines, such as "312 lines of output". */
    readonly summary: (lines: number) => string;
}

/** The time source the announcer paces itself by; `schedule` returns a function that cancels the run. */
export interface SpeechClock {
    now(): number;
    schedule(run: () => void, delayMs: number): () => void;
}

/** Output is spoken once it has paused this long... */
const SETTLE_MS = 100;
/** ...and at most this long after it started, so speech starts promptly (NFR-04). */
const MAX_WAIT_MS = 250;
/** A flood ends once output pauses this long (S3a). */
const FLOOD_QUIET_MS = 500;
/** Output this soon after typing is read as the user's edit of the line. */
const EDITING_MS = 1_000;

const SYSTEM_CLOCK: SpeechClock = {
    now: () => performance.now(),
    schedule: (run, delayMs) => {
        const handle = setTimeout(run, delayMs);
        return () => clearTimeout(handle);
    },
};

/**
 * Speaks a terminal's new output as logical lines without moving focus (A11Y-02.1, A11Y-02.2): it waits for output
 * to settle, leaves out the shell's echo of typing (A11Y-01.4, R9), summarizes floods (A11Y-02.3), and stays silent
 * while disabled, never speaking that output later (A11Y-02.4, A11Y-02.7). The first output, which restores the
 * screen on attach, is not spoken.
 */
export class OutputAnnouncer {
    readonly #speech: OutputSpeech;
    readonly #clock: SpeechClock;
    readonly #reader: OutputReader;
    readonly #echo: EchoFilter;
    readonly #flood: FloodControl;
    readonly #parsed: IDisposable;
    #primed = false;
    #firstOutput: number | undefined;
    #lastOutput = Number.NEGATIVE_INFINITY;
    #lastInput = Number.NEGATIVE_INFINITY;
    #cancelFlush: (() => void) | undefined;
    #cancelQuiet: (() => void) | undefined;

    /** Speaks `terminal`'s output through `speech`. */
    constructor(terminal: Terminal, speech: OutputSpeech, clock: SpeechClock = SYSTEM_CLOCK) {
        this.#speech = speech;
        this.#clock = clock;
        this.#reader = new OutputReader(terminal);
        this.#echo = new EchoFilter(() => clock.now());
        this.#flood = new FloodControl(speech.floodThreshold, () => clock.now());
        this.#parsed = terminal.onWriteParsed(() => this.#output());
    }

    /** Records input sent to the process, whose echo is then not spoken. */
    input(text: string): void {
        this.#lastInput = this.#clock.now();
        this.#echo.typed(text);
    }

    /** The user pressed a key: output not yet spoken is dropped, as speech stops in native apps (A11Y-02.6). */
    interrupt(): void {
        this.#speech.cancel();
        if (this.#cancelFlush !== undefined) {
            this.#stopFlush();
            this.#reader.skip();
        }
    }

    /** Drops waiting output, and treats the next output as a restored screen, not spoken, as on the first attach. */
    restart(): void {
        this.#stopFlush();
        this.#speech.cancel();
        this.#primed = false;
    }

    /** Stops speaking and tracking the terminal. */
    dispose(): void {
        this.#stopFlush();
        this.#cancelQuiet?.();
        this.#parsed.dispose();
        this.#reader.dispose();
    }

    #output(): void {
        const now = this.#clock.now();
        this.#lastOutput = now;
        this.#firstOutput ??= now;
        this.#cancelFlush?.();
        const delay = Math.min(SETTLE_MS, this.#firstOutput + MAX_WAIT_MS - now);
        this.#cancelFlush = this.#clock.schedule(() => this.#flush(), Math.max(0, delay));
    }

    #stopFlush(): void {
        this.#cancelFlush?.();
        this.#cancelFlush = undefined;
        this.#firstOutput = undefined;
    }

    #flush(): void {
        this.#stopFlush();
        if (!this.#primed || !this.#speech.enabled()) {
            this.#primed = true;
            this.#flood.reset();
            this.#reader.skip();
            return;
        }
        const limit = this.#flood.flooding ? 0 : this.#speech.floodThreshold() + 1;
        const editing = this.#clock.now() - this.#lastInput <= EDITING_MS;
        const delta = this.#reader.read({ limit, editing });
        const continued = this.#echo.strip(delta.continued).trim();
        const count = delta.count - (delta.continued !== '' && continued === '' ? 1 : 0);
        if (count === 0) {
            return;
        }
        if (this.#flood.admit(count)) {
            this.#speech.speak([continued, ...delta.lines].filter((text) => text !== '').join('\n'));
        } else {
            this.#awaitQuiet();
        }
    }

    #awaitQuiet(): void {
        this.#cancelQuiet?.();
        const wait = this.#lastOutput + FLOOD_QUIET_MS - this.#clock.now();
        this.#cancelQuiet = this.#clock.schedule(() => this.#quiet(), Math.max(0, wait));
    }

    #quiet(): void {
        this.#cancelQuiet = undefined;
        if (this.#clock.now() - this.#lastOutput < FLOOD_QUIET_MS) {
            this.#awaitQuiet();
            return;
        }
        const held = this.#flood.end();
        if (held !== undefined && this.#speech.enabled()) {
            this.#speech.speak(this.#speech.summary(held));
        }
        this.#reader.skip();
    }
}

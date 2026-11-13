import { Terminal } from '@xterm/xterm';
import { afterEach, describe, expect, it } from 'vitest';
import { OutputAnnouncer, type SpeechClock } from './output-announcer';

interface Task {
    readonly at: number;
    readonly run: () => void;
}

/** A clock that only moves when the test advances it. */
class ManualClock implements SpeechClock {
    #now = 0;
    #tasks: Task[] = [];

    now(): number {
        return this.#now;
    }

    schedule(run: () => void, delayMs: number): () => void {
        const task = { at: this.#now + delayMs, run };
        this.#tasks.push(task);
        return () => {
            this.#tasks = this.#tasks.filter((entry) => entry !== task);
        };
    }

    advance(ms: number): void {
        const target = this.#now + ms;
        for (let next = this.#due(target); next !== undefined; next = this.#due(target)) {
            this.#tasks = this.#tasks.filter((entry) => entry !== next);
            this.#now = next.at;
            next.run();
        }
        this.#now = target;
    }

    #due(target: number): Task | undefined {
        return this.#tasks.filter((task) => task.at <= target).sort((a, b) => a.at - b.at)[0];
    }
}

const disposables: { dispose(): void }[] = [];

afterEach(() => {
    for (const disposable of disposables.splice(0)) {
        disposable.dispose();
    }
});

function setUp() {
    const terminal = new Terminal({ cols: 40, rows: 6, scrollback: 1_000, allowProposedApi: true });
    const clock = new ManualClock();
    const spoken: string[] = [];
    const state = { enabled: true, cancels: 0 };
    const announcer = new OutputAnnouncer(
        terminal,
        {
            enabled: () => state.enabled,
            speak: (text) => spoken.push(text),
            cancel: () => {
                state.cancels += 1;
            },
            floodThreshold: () => 20,
            summary: (lines) => `${lines} lines of output`,
        },
        clock,
    );
    disposables.push(announcer, terminal);
    const write = (text: string): Promise<void> => new Promise((resolve) => terminal.write(text, resolve));
    const primed = async (): Promise<void> => {
        await write('restored screen\r\n$ ');
        clock.advance(1_000);
    };
    return { terminal, clock, spoken, state, announcer, write, primed };
}

function lines(count: number): string {
    return Array.from({ length: count }, (_, index) => `line ${index}\r\n`).join('');
}

describe('OutputAnnouncer: the open session’s output is spoken (A11Y-02, NFR-04)', () => {
    it('speaks new output as logical lines once it settles, but not the first output, which restores the screen', async () => {
        const { clock, spoken, write, primed } = setUp();
        await primed();
        expect(spoken).toEqual([]);
        await write('make\r\nbuilt\r\n$ ');
        clock.advance(99);
        expect(spoken).toEqual([]);
        clock.advance(1);
        expect(spoken).toEqual(['make\nbuilt\n$']);
    });

    it('speaks within 250 ms while output keeps coming', async () => {
        const { clock, spoken, write, primed } = setUp();
        await primed();
        for (let index = 0; index < 5; index += 1) {
            await write(`tick ${index}\r\n`);
            clock.advance(60);
        }
        expect(spoken[0]?.split('\n')).toEqual(['tick 0', 'tick 1', 'tick 2', 'tick 3', 'tick 4']);
    });

    it('does not speak the shell’s echo of what the user typed (A11Y-01.4, R9)', async () => {
        const { clock, spoken, announcer, write, primed } = setUp();
        await primed();
        announcer.input('ls');
        await write('ls');
        clock.advance(200);
        expect(spoken).toEqual([]);
        announcer.input('\r');
        await write('\r\nnotes.txt\r\n$ ');
        clock.advance(200);
        expect(spoken).toEqual(['notes.txt\n$']);
    });
});

describe('OutputAnnouncer: floods, silence and interruptions (A11Y-02.3, A11Y-02.6, A11Y-02.7)', () => {
    it('summarizes a flood once output pauses, then speaks line by line again (A11Y-02.3)', async () => {
        const { clock, spoken, write, primed } = setUp();
        await primed();
        await write(lines(50));
        clock.advance(200);
        await write(lines(10));
        clock.advance(499);
        expect(spoken).toEqual([]);
        clock.advance(1);
        expect(spoken).toEqual(['60 lines of output']);
        await write('next\r\n');
        clock.advance(200);
        expect(spoken).toEqual(['60 lines of output', 'next']);
    });

    it('stays silent while disabled, and never speaks that output later (A11Y-02.4, A11Y-02.7)', async () => {
        const { clock, spoken, state, write, primed } = setUp();
        await primed();
        state.enabled = false;
        await write('in the background\r\n');
        clock.advance(200);
        state.enabled = true;
        await write('in front\r\n');
        clock.advance(200);
        expect(spoken).toEqual(['in front']);
    });

    it('drops a flood summary when output is disabled before it pauses', async () => {
        const { clock, spoken, state, write, primed } = setUp();
        await primed();
        await write(lines(50));
        clock.advance(200);
        state.enabled = false;
        clock.advance(1_000);
        expect(spoken).toEqual([]);
    });

    it('drops output waiting to be spoken when the user presses a key, and speaks what follows (A11Y-02.6)', async () => {
        const { clock, spoken, state, announcer, write, primed } = setUp();
        await primed();
        await write('interrupted\r\n');
        announcer.interrupt();
        expect(state.cancels).toBe(1);
        clock.advance(200);
        expect(spoken).toEqual([]);
        await write('after\r\n');
        clock.advance(200);
        expect(spoken).toEqual(['after']);
    });
});

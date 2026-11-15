import { describe, expect, it } from 'vitest';
import type { ConnectionState } from '../../shared/connection';
import { type ReconnectClock, Reconnector } from './reconnector';

class FakeClock implements ReconnectClock {
    time = 1_000_000;
    readonly #timers = new Map<number, { readonly at: number; readonly callback: () => void }>();
    #next = 1;

    now(): number {
        return this.time;
    }

    random(): number {
        return 0.5;
    }

    setTimeout(callback: () => void, ms: number): unknown {
        const id = this.#next++;
        this.#timers.set(id, { at: this.time + ms, callback });
        return id;
    }

    clearTimeout(handle: unknown): void {
        this.#timers.delete(handle as number);
    }

    advance(ms: number): void {
        this.time += ms;
        for (const [id, timer] of [...this.#timers]) {
            if (timer.at <= this.time) {
                this.#timers.delete(id);
                timer.callback();
            }
        }
    }
}

const daemon = { version: '0.3.0', sha256: 'a', proto: 2 };
const lost: ConnectionState = { status: 'disconnected', reason: 'ping-timeout' };
const unreachable: ConnectionState = {
    status: 'failed',
    failure: { kind: 'unreachable', host: 'h', port: 22, details: '' },
};

function fixture() {
    const clock = new FakeClock();
    const reports: ConnectionState[] = [];
    let attempts = 0;
    const reconnector = new Reconnector(
        () => {
            attempts += 1;
        },
        (state) => reports.push(state),
        clock,
    );
    reconnector.enable();
    return { clock, reports, reconnector, attempts: () => attempts };
}

describe('Reconnector (US-2.2, P-29)', () => {
    it('reports reconnecting at once after a loss, and tries at once', () => {
        const { clock, reports, reconnector, attempts } = fixture();
        reconnector.onState(lost);
        expect(reports).toEqual([
            { status: 'reconnecting', attempt: 1, nextAttemptAt: clock.time, failure: undefined },
        ]);
        clock.advance(0);
        expect(attempts()).toBe(1);
    });

    it('backs off after each failed attempt, naming the failure', () => {
        const { clock, reports, reconnector, attempts } = fixture();
        reconnector.onState(lost);
        clock.advance(0);
        reconnector.onState(unreachable);
        expect(reports.at(-1)).toMatchObject({ attempt: 2, nextAttemptAt: clock.time + 1_000 });
        expect(reports.at(-1)).toMatchObject({ failure: { kind: 'unreachable' } });
        clock.advance(999);
        expect(attempts()).toBe(1);
        clock.advance(1);
        expect(attempts()).toBe(2);
    });

    it('starts over once connected', () => {
        const { clock, reports, reconnector } = fixture();
        reconnector.onState(lost);
        clock.advance(0);
        reconnector.onState(unreachable);
        reconnector.onState({ status: 'connected', daemon });
        reconnector.onState(lost);
        expect(reports.at(-1)).toMatchObject({ attempt: 1 });
    });

    it('waits for the user after a failure only they can fix (US-2.2.4)', () => {
        const { clock, reports, reconnector, attempts } = fixture();
        reconnector.onState(lost);
        clock.advance(0);
        reconnector.onState({
            status: 'failed',
            failure: { kind: 'authentication', cause: 'agent-empty', details: '' },
        });
        clock.advance(60_000);
        expect(attempts()).toBe(1);
        expect(reports).toHaveLength(1);
        expect(reconnector.waiting).toBe(false);
    });

    it('tries now and starts over after a network change or wake', () => {
        const { clock, reconnector, attempts } = fixture();
        reconnector.onState(lost);
        clock.advance(0);
        for (let attempt = 0; attempt < 6; attempt += 1) {
            reconnector.onState(unreachable);
            clock.advance(5_000);
        }
        reconnector.onState(unreachable);
        const before = attempts();
        reconnector.retryNow();
        expect(attempts()).toBe(before + 1);
    });
});

describe('Reconnector: network changes and install failures (P-29, P-34)', () => {
    it('spaces the tries network changes and wakes start at least 5 s apart', () => {
        const { clock, reconnector, attempts } = fixture();
        reconnector.onState(lost);
        clock.advance(0);
        reconnector.onState(unreachable);
        reconnector.retrySoon();
        expect(attempts()).toBe(2);
        reconnector.onState(unreachable);
        clock.advance(0);
        expect(attempts()).toBe(3);
        reconnector.onState(unreachable);
        reconnector.retrySoon();
        clock.advance(4_000);
        expect(attempts()).toBe(3);
        clock.advance(1_000);
        expect(attempts()).toBe(4);
    });

    it('retries an install failure that may pass at most 3 times in a row, until the user tries again (P-29)', () => {
        const { clock, reconnector, attempts } = fixture();
        const busy: ConnectionState = {
            status: 'failed',
            failure: { kind: 'install', code: 'lock-busy', details: '' },
        };
        reconnector.onState(lost);
        clock.advance(0);
        for (let attempt = 0; attempt < 3; attempt += 1) {
            expect(reconnector.retries(busy)).toBe(true);
            reconnector.onState(busy);
            clock.advance(5_000);
        }
        expect(attempts()).toBe(4);
        expect(reconnector.retries(busy)).toBe(false);
        reconnector.onState(busy);
        expect(reconnector.waiting).toBe(false);
        reconnector.enable();
        expect(reconnector.retries(busy)).toBe(true);
    });
});

describe('Reconnector: when it retries (US-2.2.3, US-2.3.3)', () => {
    it('stops for good when disabled: a disconnect or Stop retrying (US-2.2.3)', () => {
        const { clock, reconnector, attempts } = fixture();
        reconnector.onState(lost);
        reconnector.disable();
        clock.advance(60_000);
        expect(attempts()).toBe(0);
        reconnector.onState(lost);
        clock.advance(60_000);
        expect(attempts()).toBe(0);
    });

    it('leaves a first connection that fails to the user, unless the launch restores it (US-1.3, US-2.3.3)', () => {
        const { clock, reconnector, attempts } = fixture();
        expect(reconnector.retries(unreachable)).toBe(false);
        reconnector.onState(unreachable);
        clock.advance(60_000);
        expect(attempts()).toBe(0);
        reconnector.enable({ restore: true });
        expect(reconnector.retries(unreachable)).toBe(true);
        reconnector.onState(unreachable);
        clock.advance(0);
        expect(attempts()).toBe(1);
    });

    it('retries the failures of a host that has connected since the user connected it', () => {
        const { clock, reconnector, attempts } = fixture();
        reconnector.onState({ status: 'connected', daemon });
        expect(reconnector.retries(unreachable)).toBe(true);
        expect(reconnector.retries({ status: 'failed', failure: { kind: 'ssh-missing', details: '' } })).toBe(false);
        reconnector.onState(unreachable);
        clock.advance(1_000);
        expect(attempts()).toBe(1);
        reconnector.disable();
        expect(reconnector.retries(unreachable)).toBe(false);
    });

    it('never reconnects a host nobody connected', () => {
        const clock = new FakeClock();
        let attempts = 0;
        const reconnector = new Reconnector(
            () => {
                attempts += 1;
            },
            () => undefined,
            clock,
        );
        reconnector.onState(lost);
        clock.advance(60_000);
        expect(attempts).toBe(0);
    });
});

import { describe, expect, it } from 'vitest';
import { type AnnouncementSink, Announcer, LiveRegionSink } from './announcer';

class RecordingSink implements AnnouncementSink {
    readonly spoken: string[] = [];
    speak(text: string, politeness: 'polite' | 'assertive'): void {
        this.spoken.push(`${politeness}: ${text}`);
    }
}

class ManualClock {
    #now = 0;
    readonly #timers: { at: number; run: () => void }[] = [];
    now = (): number => this.#now;
    schedule = (run: () => void, delay: number): void => {
        this.#timers.push({ at: this.#now + delay, run });
    };
    advance(ms: number): void {
        this.#now += ms;
        for (const timer of this.#timers.splice(0).sort((a, b) => a.at - b.at)) {
            if (timer.at <= this.#now) {
                timer.run();
            } else {
                this.#timers.push(timer);
            }
        }
    }
}

function announcer() {
    const sink = new RecordingSink();
    const clock = new ManualClock();
    return { sink, clock, announcer: new Announcer(sink, { now: clock.now, schedule: clock.schedule }) };
}

describe('Announcer: status messages that never move focus (A11Y-12.1, A11Y-12.3)', () => {
    it('speaks the first message at once, and spaces the rest at least 500 ms apart', () => {
        const { sink, clock, announcer: speaker } = announcer();
        speaker.announce('devbox connected', { group: 'host-a' });
        speaker.announce('build connected', { group: 'host-b' });
        expect(sink.spoken).toEqual(['polite: devbox connected']);
        clock.advance(500);
        expect(sink.spoken).toEqual(['polite: devbox connected', 'polite: build connected']);
    });

    it('merges a burst in one group to its latest message', () => {
        const { sink, clock, announcer: speaker } = announcer();
        speaker.announce('first', { group: 'x' });
        speaker.announce('connecting', { group: 'host-a' });
        speaker.announce('uploading', { group: 'host-a' });
        speaker.announce('connected', { group: 'host-a' });
        clock.advance(500);
        clock.advance(500);
        expect(sink.spoken).toEqual(['polite: first', 'polite: connected']);
    });

    it('joins output still waiting in an appending group, line after line (A11Y-02.1)', () => {
        const { sink, clock, announcer: speaker } = announcer();
        speaker.announce('connected', { group: 'host-a' });
        speaker.announce('line one', { group: 'output', append: true });
        speaker.announce('line two', { group: 'output', append: true });
        clock.advance(500);
        expect(sink.spoken).toEqual(['polite: connected', 'polite: line one\nline two']);
    });

    it('drops a group’s waiting message when it is cancelled, so stopped speech is not queued again (A11Y-02.6)', () => {
        const { sink, clock, announcer: speaker } = announcer();
        speaker.announce('connected', { group: 'host-a' });
        speaker.announce('old output', { group: 'output', append: true });
        speaker.announce('build connected', { group: 'host-b' });
        speaker.cancel('output');
        clock.advance(500);
        clock.advance(500);
        expect(sink.spoken).toEqual(['polite: connected', 'polite: build connected']);
    });

    it('speaks an assertive message ahead of waiting polite ones', () => {
        const { sink, clock, announcer: speaker } = announcer();
        speaker.announce('one');
        speaker.announce('two');
        speaker.announce('Disconnected, input not sent', { politeness: 'assertive' });
        clock.advance(500);
        clock.advance(500);
        expect(sink.spoken).toEqual(['polite: one', 'assertive: Disconnected, input not sent', 'polite: two']);
    });
});

describe('LiveRegionSink: live regions when ariaNotify is missing', () => {
    it('writes polite and assertive text into hidden live regions, again for a repeated message', async () => {
        const host = document.createElement('div');
        document.body.append(host);
        const sink = new LiveRegionSink(host, { useAriaNotify: false });
        sink.speak('Tab moves focus', 'polite');
        const polite = host.querySelector('[aria-live="polite"]');
        const assertive = host.querySelector('[aria-live="assertive"]');
        expect(polite?.textContent).toBe('Tab moves focus');
        sink.speak('Disconnected', 'assertive');
        expect(assertive?.textContent).toBe('Disconnected');
        sink.speak('Tab moves focus', 'polite');
        expect(polite?.textContent).toBe('Tab moves focus\u00a0');
        host.remove();
    });
});

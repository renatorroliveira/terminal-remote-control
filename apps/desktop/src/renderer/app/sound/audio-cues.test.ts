import { describe, expect, it } from 'vitest';
import { AUDIO_CUES, type AudioCue, AudioCues, type ToneContext } from './audio-cues';

interface Played {
    readonly frequency: number;
    readonly start: number;
    readonly stop: number;
    readonly gain: number;
}

class FakeToneContext implements ToneContext {
    readonly currentTime = 10;
    readonly played: Played[] = [];
    resumed = 0;

    resume(): Promise<void> {
        this.resumed += 1;
        return Promise.resolve();
    }

    tone(frequency: number, start: number, stop: number, gain: number): void {
        this.played.push({ frequency, start, stop, gain });
    }
}

function totalSeconds(tones: readonly { readonly seconds: number }[]): number {
    return tones.reduce((total, tone) => total + tone.seconds, 0);
}

function shapeOf(tones: readonly { readonly frequency: number }[]): string {
    return tones.map((tone) => tone.frequency).join('-');
}

function setup(state: { audioCues: boolean; audioVolume: number }) {
    const context = new FakeToneContext();
    const cues = new AudioCues(
        () => state,
        () => context,
    );
    return { context, cues };
}

describe('AudioCues: short tones beside every announcement (A11Y-12.4)', () => {
    it('plays nothing while sound cues are off or the volume is 0', () => {
        const off = setup({ audioCues: false, audioVolume: 50 });
        off.cues.play('bell');
        expect(off.context.played).toEqual([]);
        const silent = setup({ audioCues: true, audioVolume: 0 });
        silent.cues.play('bell');
        expect(silent.context.played).toEqual([]);
    });

    it('plays each cue’s tones in turn at the volume set', () => {
        const { context, cues } = setup({ audioCues: true, audioVolume: 50 });
        cues.play('connected');
        const tones = AUDIO_CUES.connected;
        expect(context.played.map((tone) => tone.frequency)).toEqual(tones.map((tone) => tone.frequency));
        expect(context.played[0]?.start).toBe(context.currentTime);
        expect(context.played[1]?.start).toBe(context.played[0]?.stop);
        expect(new Set(context.played.map((tone) => tone.gain))).toEqual(new Set([0.5 * 0.4]));
        expect(context.resumed).toBe(1);
    });

    it('keeps every cue under 3 seconds and tells the cues apart', () => {
        const cues = Object.entries(AUDIO_CUES) as [AudioCue, (typeof AUDIO_CUES)[AudioCue]][];
        for (const [, tones] of cues) {
            expect(totalSeconds(tones)).toBeLessThan(3);
        }
        const shapes = cues.map(([, tones]) => shapeOf(tones));
        expect(new Set(shapes).size).toBe(cues.length);
    });
});

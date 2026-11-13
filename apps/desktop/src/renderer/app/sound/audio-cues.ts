import type { Settings } from '../../../shared/settings';

/** Something that has a sound cue beside its announcement (A11Y-12.4). */
export type AudioCue = 'bell' | 'connected' | 'disconnected' | 'failed' | 'input-refused';

/** One tone of a cue. */
export interface Tone {
    readonly frequency: number;
    readonly seconds: number;
}

/** Each cue's tones: rising for a connection, falling for a loss, low for a refusal, all under 3 seconds. */
export const AUDIO_CUES: Readonly<Record<AudioCue, readonly Tone[]>> = {
    bell: [{ frequency: 880, seconds: 0.15 }],
    connected: [
        { frequency: 523.25, seconds: 0.12 },
        { frequency: 783.99, seconds: 0.16 },
    ],
    disconnected: [
        { frequency: 783.99, seconds: 0.12 },
        { frequency: 523.25, seconds: 0.2 },
    ],
    failed: [
        { frequency: 392, seconds: 0.15 },
        { frequency: 261.63, seconds: 0.25 },
    ],
    'input-refused': [{ frequency: 220, seconds: 0.2 }],
};

/** What a cue plays through: a clock and a tone generator, Web Audio in the app. */
export interface ToneContext {
    readonly currentTime: number;
    resume(): Promise<void>;
    /** Plays a sine tone from `start` to `stop` seconds at `gain`, fading in and out so it never clicks. */
    tone(frequency: number, start: number, stop: number, gain: number): void;
}

/** The loudest a cue plays, at 100% volume, so it never startles. */
const MAX_GAIN = 0.4;

/**
 * Sound cues (A11Y-12.4): short generated tones, with no sound files (P-18), that only add to an announcement or a
 * visual sign, so nothing depends on them. Off unless the user turns them on; the volume setting scales them.
 */
export class AudioCues {
    readonly #settings: () => Pick<Settings, 'audioCues' | 'audioVolume'>;
    readonly #createContext: () => ToneContext;
    #context: ToneContext | undefined;

    /** Cues that read the current settings and create their tone context when first needed. */
    constructor(settings: () => Pick<Settings, 'audioCues' | 'audioVolume'>, createContext: () => ToneContext) {
        this.#settings = settings;
        this.#createContext = createContext;
    }

    /** Plays a cue, unless sound cues are off or the volume is 0. */
    play(cue: AudioCue): void {
        const { audioCues, audioVolume } = this.#settings();
        if (!audioCues || audioVolume <= 0) {
            return;
        }
        this.#context ??= this.#createContext();
        const context = this.#context;
        void context.resume();
        const gain = (audioVolume / 100) * MAX_GAIN;
        let start = context.currentTime;
        for (const tone of AUDIO_CUES[cue]) {
            context.tone(tone.frequency, start, start + tone.seconds, gain);
            start += tone.seconds;
        }
    }
}

/** A tone context over Web Audio. */
export function webAudioContext(): ToneContext {
    const audio = new AudioContext();
    return {
        get currentTime() {
            return audio.currentTime;
        },
        resume: () => audio.resume(),
        tone: (frequency, start, stop, gain) => {
            const oscillator = new OscillatorNode(audio, { type: 'sine', frequency });
            const envelope = new GainNode(audio, { gain: 0 });
            envelope.gain.setValueAtTime(0, start);
            envelope.gain.linearRampToValueAtTime(gain, start + 0.01);
            envelope.gain.setValueAtTime(gain, Math.max(start + 0.01, stop - 0.02));
            envelope.gain.linearRampToValueAtTime(0, stop);
            oscillator.connect(envelope).connect(audio.destination);
            oscillator.start(start);
            oscillator.stop(stop);
        },
    };
}

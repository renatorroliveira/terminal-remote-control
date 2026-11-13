import {
    type AccessibilityState,
    assistiveTechnologyActive,
    type ScreenReaderMode,
    screenReaderOn,
} from '../../shared/accessibility';
import type { TrcBridge } from '../../shared/contract';

/**
 * Whether assistive technology such as VoiceOver is using the app, and whether screen-reader mode is on
 * (A11Y-10.2), kept current from the main process.
 */
export class AssistiveTechnology {
    /** Settles once the first answer has arrived. */
    readonly ready: Promise<void>;
    readonly #bridge: TrcBridge['accessibility'];
    readonly #listeners = new Set<(on: boolean) => void>();
    #state: AccessibilityState = { supportEnabled: false, mode: 'auto' };
    #changed = false;

    /** Asks the main process now and follows its changes. */
    constructor(bridge: TrcBridge['accessibility']) {
        this.#bridge = bridge;
        bridge.onChanged((state) => {
            this.#changed = true;
            this.#apply(state);
        });
        this.ready = bridge.get().then((state) => {
            if (!this.#changed) {
                this.#state = state;
            }
        });
    }

    /** Whether the terminal keeps its assistive-technology cadence (S3a). */
    get active(): boolean {
        return assistiveTechnologyActive(this.#state);
    }

    /** Whether screen-reader mode is on, which speaks the open session's output (A11Y-02, A11Y-10.2). */
    get screenReader(): boolean {
        return screenReaderOn(this.#state);
    }

    /** The screen-reader mode the user picked, or automatic. */
    get mode(): ScreenReaderMode {
        return this.#state.mode;
    }

    /** Sets and keeps the screen-reader mode. */
    setMode(mode: ScreenReaderMode): Promise<void> {
        return this.#bridge.setMode(mode);
    }

    /** Calls `listener` whenever screen-reader mode turns on or off; returns a function that stops it. */
    onScreenReaderChanged(listener: (on: boolean) => void): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    #apply(state: AccessibilityState): void {
        const was = this.screenReader;
        this.#state = state;
        if (this.screenReader !== was) {
            for (const listener of this.#listeners) {
                listener(this.screenReader);
            }
        }
    }
}

import type { TrcBridge } from '../../shared/contract';

/** Whether assistive technology such as VoiceOver is using the app, kept current from the main process. */
export class AssistiveTechnology {
    /** Settles once the first answer has arrived. */
    readonly ready: Promise<void>;
    #active = false;
    #changed = false;

    /** Asks the main process now and follows its changes. */
    constructor(bridge: TrcBridge['accessibility']) {
        bridge.onChanged((active) => {
            this.#changed = true;
            this.#active = active;
        });
        this.ready = bridge.get().then((active) => {
            if (!this.#changed) {
                this.#active = active;
            }
        });
    }

    /** Whether assistive technology is active now. */
    get active(): boolean {
        return this.#active;
    }
}

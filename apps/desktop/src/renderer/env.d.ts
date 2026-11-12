import type { TrcBridge } from '../shared/contract';

declare global {
    interface Window {
        /** The preload's bridge to the main process. */
        readonly trc: TrcBridge;
    }
}

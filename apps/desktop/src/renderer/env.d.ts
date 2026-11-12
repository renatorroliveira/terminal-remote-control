import type { TrcBridge } from '../shared/contract';

declare global {
    /** Whether this is a test build; release builds drop the test host panel (P-14). */
    const __TRC_TEST_SEAM__: boolean;

    interface Window {
        /** The preload's bridge to the main process. */
        readonly trc: TrcBridge;
    }
}

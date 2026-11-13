/** When output reached the terminal and when xterm.js had parsed it, in `performance.now()` milliseconds. */
export interface WriteTiming {
    readonly arrived: number;
    readonly parsed: number;
    readonly bytes: number;
}

interface TimingWindow {
    __trcWriteTimings?: WriteTiming[];
}

/**
 * Hands a parsed write's timing to a test that set `__trcWriteTimings`, so ST-19 can split keystroke latency into
 * the app's part and the display's next frame (NFR-02). Only test builds call it (P-14).
 */
export function reportWriteTiming(arrived: number, parsed: number, bytes: number): void {
    (globalThis as TimingWindow).__trcWriteTimings?.push({ arrived, parsed, bytes });
}

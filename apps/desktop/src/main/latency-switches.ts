/** Where the switches go: Chromium's command line, before the app is ready. */
export interface FeatureSwitchTarget {
    appendSwitch(name: string, value?: string): void;
}

/**
 * Turns off Chromium's `DeferRendererTasksAfterInput`, which after a key press holds every task but rendering until
 * the next frame: the terminal output that echoes the key waited up to a frame for it, about 5 ms at p50 and 9 ms
 * at p95 on a 100 Hz display (S13, NFR-02). Must run before the app is ready.
 */
export function tuneInputLatency(commandLine: FeatureSwitchTarget): void {
    commandLine.appendSwitch('disable-features', 'DeferRendererTasksAfterInput');
}

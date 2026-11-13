/** The part of `app.commandLine` the guard uses. */
export interface CommandLineSwitches {
    hasSwitch(name: string): boolean;
    removeSwitch(name: string): void;
}

/** The Chromium switches that open a DevTools endpoint, which no fuse turns off. */
const DEBUGGING_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe', 'remote-allow-origins'] as const;

/**
 * Removes the remote-debugging switches before the browser starts its DevTools server, so a release build opens no
 * listener, not even on loopback (SEC-01); the fuses already refuse `--inspect`. Test builds keep them for
 * Playwright (P-14). Returns the switches it removed.
 */
export function refuseRemoteDebugging(
    commandLine: CommandLineSwitches,
    build: { readonly testBuild: boolean },
): readonly string[] {
    if (build.testBuild) {
        return [];
    }
    const present = DEBUGGING_SWITCHES.filter((name) => commandLine.hasSwitch(name));
    for (const name of present) {
        commandLine.removeSwitch(name);
    }
    return present;
}

/** Where the background-launch decision comes from. */
export interface BackgroundLaunchSources {
    /** Whether this is a test build; release builds always open in front. */
    readonly seamEnabled: boolean;
    readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * Whether a test build should open behind the focused app, so automated test runs never take the developer's
 * focus (`TRC_TEST_BACKGROUND=1`). Release builds compile this out with the rest of the P-14 seam.
 */
export function isBackgroundLaunch(sources: BackgroundLaunchSources): boolean {
    return sources.seamEnabled && sources.env['TRC_TEST_BACKGROUND'] === '1';
}

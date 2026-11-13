/** The part of a window's `WebContents` the guard uses. */
export interface GuardedContents {
    on(event: 'will-navigate', listener: (event: { preventDefault(): void }, url: string) => void): unknown;
    setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void;
}

/**
 * Keeps the main window on the app's page (SEC-01): it refuses every navigation the page starts, a dropped file
 * included, and every new window. Links open only through the link service's confirmation (D-38).
 */
export function refuseNavigation(contents: GuardedContents): void {
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

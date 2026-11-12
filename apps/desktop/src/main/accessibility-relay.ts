import { app, type BrowserWindow } from 'electron';
import { ACCESSIBILITY_CHANGED_CHANNEL } from '../shared/contract';

/**
 * Tells the window whenever assistive technology starts or stops using the app, so the terminal can switch to
 * its screen-reader cadence (S3a, A11Y-02).
 */
export function relayAccessibilitySupport(window: BrowserWindow): void {
    const send = (_event: unknown, active: boolean): void => {
        if (!window.isDestroyed()) {
            window.webContents.send(ACCESSIBILITY_CHANGED_CHANNEL, active);
        }
    };
    app.on('accessibility-support-changed', send);
    window.on('closed', () => app.off('accessibility-support-changed', send));
}

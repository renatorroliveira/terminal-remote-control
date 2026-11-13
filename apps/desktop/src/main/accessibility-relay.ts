import { app, type BrowserWindow } from 'electron';
import { ACCESSIBILITY_CHANGED_CHANNEL } from '../shared/contract';
import type { ScreenReaderSetting } from './screen-reader-mode';

/**
 * Tells the window whenever assistive technology starts or stops using the app, or the user changes
 * screen-reader mode, so the terminal switches its cadence and its spoken output (S3a, A11Y-02, A11Y-10.2).
 */
export function relayAccessibility(window: BrowserWindow, setting: ScreenReaderSetting): void {
    const supportChanged = (): void => setting.supportChanged();
    app.on('accessibility-support-changed', supportChanged);
    const stop = setting.onChanged((state) => {
        if (!window.isDestroyed()) {
            window.webContents.send(ACCESSIBILITY_CHANGED_CHANNEL, state);
        }
    });
    window.on('closed', () => {
        app.off('accessibility-support-changed', supportChanged);
        stop();
    });
}

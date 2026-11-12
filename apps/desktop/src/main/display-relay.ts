import { type BrowserWindow, nativeTheme, systemPreferences } from 'electron';
import { DISPLAY_CHANGED_CHANNEL } from '../shared/contract';
import type { DisplaySettings } from '../shared/display';
import { readDisplaySettings } from './display-settings';

/** The OS display settings now. */
export function currentDisplaySettings(): DisplaySettings {
    return readDisplaySettings(nativeTheme, systemPreferences.getAnimationSettings());
}

/** Sends the window the display settings whenever the OS changes them (A11Y-07.3, A11Y-08.3). */
export function relayDisplaySettings(window: BrowserWindow): void {
    const send = (): void => {
        if (!window.isDestroyed()) {
            window.webContents.send(DISPLAY_CHANGED_CHANNEL, currentDisplaySettings());
        }
    };
    nativeTheme.on('updated', send);
    window.on('focus', send);
    window.on('closed', () => nativeTheme.off('updated', send));
}

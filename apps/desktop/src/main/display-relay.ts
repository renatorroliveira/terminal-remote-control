import { type BrowserWindow, nativeTheme, systemPreferences } from 'electron';
import { DISPLAY_CHANGED_CHANNEL } from '../shared/contract';
import type { DisplaySettings, ThemePreference } from '../shared/display';
import { readDisplaySettings } from './display-settings';

/** Relays the OS display settings and the picked theme to the app's windows (A11Y-07.3, A11Y-08.3). */
export class DisplayRelay {
    readonly #windows = new Set<BrowserWindow>();
    #preference: ThemePreference;

    /** Starts with the stored theme preference and follows `nativeTheme`. */
    constructor(preference: ThemePreference) {
        this.#preference = preference;
        nativeTheme.on('updated', () => this.#broadcast());
    }

    /** The display settings now. */
    current(): DisplaySettings {
        return readDisplaySettings(nativeTheme, systemPreferences.getAnimationSettings(), this.#preference);
    }

    /** Sends `window` the settings whenever they change, and when it regains focus. */
    attach(window: BrowserWindow): void {
        this.#windows.add(window);
        window.on('focus', () => this.#send(window));
        window.on('closed', () => this.#windows.delete(window));
    }

    /** Applies a newly picked theme everywhere. */
    setPreference(preference: ThemePreference): void {
        this.#preference = preference;
        this.#broadcast();
    }

    #broadcast(): void {
        for (const window of this.#windows) {
            this.#send(window);
        }
    }

    #send(window: BrowserWindow): void {
        if (!window.isDestroyed()) {
            window.webContents.send(DISPLAY_CHANGED_CHANNEL, this.current());
        }
    }
}

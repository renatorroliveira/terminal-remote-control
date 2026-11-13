import { createStore, type StoreApi } from 'zustand/vanilla';
import type { TrcBridge } from '../../../shared/contract';
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/settings';

/** Where the settings are kept: the main process's `config.json` (P-18). */
export type SettingsSource = TrcBridge['settings'];

/**
 * The settings page's settings in the renderer (A11Y-10.3). A change applies at once, so what it affects follows
 * without waiting, and is then kept in `config.json`.
 */
export class SettingsStore {
    /** The current settings, for the page and for what they affect. */
    readonly state: StoreApi<Settings> = createStore<Settings>(() => DEFAULT_SETTINGS);
    readonly #source: SettingsSource;

    /** A store at the defaults until {@link SettingsStore.load} reads the kept settings. */
    constructor(source: SettingsSource) {
        this.#source = source;
    }

    /** The current settings. */
    get current(): Settings {
        return this.state.getState();
    }

    /** Reads the kept settings, such as a theme the View menu changed. */
    async load(): Promise<void> {
        this.state.setState(await this.#source.get(), true);
    }

    /** Changes some settings now and keeps them. */
    update(change: Partial<Settings>): Promise<void> {
        this.state.setState(change);
        return this.#source.set(change);
    }
}

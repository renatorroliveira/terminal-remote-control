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
    /** Goes up each time a change could not be kept and was undone, for the shell to report (WCAG 3.3.1). */
    readonly failures: StoreApi<number> = createStore<number>(() => 0);
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

    /** Changes some settings now and keeps them; a change `config.json` refuses is undone and counted in `failures`. */
    async update(change: Partial<Settings>): Promise<void> {
        const before = this.state.getState();
        this.state.setState(change);
        try {
            await this.#source.set(change);
        } catch {
            this.#undo(change, before);
            this.failures.setState((count) => count + 1, true);
        }
    }

    #undo(change: Partial<Settings>, before: Settings): void {
        const current = this.state.getState();
        const keys = (Object.keys(change) as (keyof Settings)[]).filter((key) => current[key] === change[key]);
        this.state.setState(Object.fromEntries(keys.map((key) => [key, before[key]])) as Partial<Settings>);
    }
}

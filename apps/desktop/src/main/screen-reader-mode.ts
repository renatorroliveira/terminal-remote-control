import { type AccessibilityState, SCREEN_READER_MODES, type ScreenReaderMode } from '../shared/accessibility';

const FLAG = '--screen-reader-mode=';

/** The mode `--screen-reader-mode=on|off|auto` forces for this launch, if the command line has it (A11Y-10.2). */
export function screenReaderFlag(argv: readonly string[]): ScreenReaderMode | undefined {
    const value = argv.find((argument) => argument.startsWith(FLAG))?.slice(FLAG.length);
    return SCREEN_READER_MODES.find((mode) => mode === value);
}

/** What the setting starts from. */
export interface ScreenReaderSettingOptions {
    /** The mode kept in `config.json`. */
    readonly stored: ScreenReaderMode;
    /** The mode the command line forces for this launch. */
    readonly flag?: ScreenReaderMode | undefined;
    /** Whether Chromium's accessibility support is on now. */
    readonly supportEnabled: () => boolean;
    /** Keeps a mode the user picks. */
    readonly save: (mode: ScreenReaderMode) => Promise<void>;
}

/**
 * Screen-reader mode (A11Y-10.2): Chromium's detection of assistive technology, which the user can override from
 * settings, kept in `config.json`, and for one launch from the command line.
 */
export class ScreenReaderSetting {
    readonly #supportEnabled: () => boolean;
    readonly #save: (mode: ScreenReaderMode) => Promise<void>;
    readonly #listeners = new Set<(state: AccessibilityState) => void>();
    #mode: ScreenReaderMode;

    /** Starts with the flag's mode when there is one, otherwise the stored one. */
    constructor(options: ScreenReaderSettingOptions) {
        this.#mode = options.flag ?? options.stored;
        this.#supportEnabled = options.supportEnabled;
        this.#save = options.save;
    }

    /** The state now. */
    current(): AccessibilityState {
        return { supportEnabled: this.#supportEnabled(), mode: this.#mode };
    }

    /** Applies and keeps a mode the user picked. */
    async setMode(mode: ScreenReaderMode): Promise<void> {
        this.#mode = mode;
        this.#report();
        await this.#save(mode);
    }

    /** Reports that Chromium's accessibility support turned on or off. */
    supportChanged(): void {
        this.#report();
    }

    /** Calls `listener` with each change; returns a function that stops it. */
    onChanged(listener: (state: AccessibilityState) => void): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    #report(): void {
        const state = this.current();
        for (const listener of this.#listeners) {
            listener(state);
        }
    }
}

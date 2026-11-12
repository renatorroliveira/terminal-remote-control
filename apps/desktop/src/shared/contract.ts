import type { DisplaySettings } from './display';

/** Requests the renderer makes of the main process with `ipcRenderer.invoke`: arguments and result per channel. */
export interface InvokeContract {
    readonly 'display:get': { readonly args: readonly []; readonly result: DisplaySettings };
    readonly 'accessibility:get': { readonly args: readonly []; readonly result: boolean };
}

/** One invoke channel. */
export type InvokeChannel = keyof InvokeContract;

/** The event the main process sends when the OS display settings change. */
export const DISPLAY_CHANGED_CHANNEL = 'display:changed';

/** The event the main process sends when assistive technology starts or stops using the app. */
export const ACCESSIBILITY_CHANGED_CHANNEL = 'accessibility:changed';

/** The event the main process sends for a menu command the renderer carries out. */
export const APP_COMMAND_CHANNEL = 'app:command';

/** Commands the menus send to the renderer. */
export type AppCommand = 'help.userGuide' | 'help.accessibility';

/** The API the preload exposes to the renderer as `window.trc`. */
export interface TrcBridge {
    readonly platform: string;
    readonly display: {
        /** The current OS display settings. */
        get(): Promise<DisplaySettings>;
        /** Calls `listener` whenever they change; returns a function that stops listening. */
        onChanged(listener: (settings: DisplaySettings) => void): () => void;
    };
    readonly accessibility: {
        /** Whether assistive technology such as VoiceOver is using the app. */
        get(): Promise<boolean>;
        /** Calls `listener` whenever that changes; returns a function that stops listening. */
        onChanged(listener: (active: boolean) => void): () => void;
    };
    readonly commands: {
        /** Calls `listener` with each menu command; returns a function that stops listening. */
        onCommand(listener: (command: AppCommand) => void): () => void;
    };
}

import type { DisplaySettings } from './display';
import type { KnownHost } from './hosts';
import type { CommandId } from './keymap';

/** Requests the renderer makes of the main process with `ipcRenderer.invoke`: arguments and result per channel. */
export interface InvokeContract {
    readonly 'display:get': { readonly args: readonly []; readonly result: DisplaySettings };
    readonly 'accessibility:get': { readonly args: readonly []; readonly result: boolean };
    readonly 'hosts:list': { readonly args: readonly []; readonly result: readonly KnownHost[] };
    readonly 'hosts:add': { readonly args: readonly [address: string]; readonly result: KnownHost };
    readonly 'sidebar:get-width': { readonly args: readonly []; readonly result: number };
    readonly 'sidebar:set-width': { readonly args: readonly [width: number]; readonly result: undefined };
    readonly 'sidebar:get-collapsed': { readonly args: readonly []; readonly result: boolean };
    readonly 'sidebar:set-collapsed': { readonly args: readonly [collapsed: boolean]; readonly result: undefined };
}

/** One invoke channel. */
export type InvokeChannel = keyof InvokeContract;

/** The event the main process sends when the OS display settings change. */
export const DISPLAY_CHANGED_CHANNEL = 'display:changed';

/** The event the main process sends when assistive technology starts or stops using the app. */
export const ACCESSIBILITY_CHANGED_CHANNEL = 'accessibility:changed';

/** The event the main process sends for a menu command the renderer carries out. */
export const APP_COMMAND_CHANNEL = 'app:command';

/** Commands the menus send to the renderer, which runs every command (docs/design/keymap.md). */
export type AppCommand = CommandId;

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
    readonly hosts: {
        /** The hosts the user added, in order. */
        list(): Promise<readonly KnownHost[]>;
        /** Adds a host from what the user typed; rejects an address ssh could not use. */
        add(address: string): Promise<KnownHost>;
    };
    readonly sidebar: {
        /** The sidebar width the user last chose, in CSS pixels. */
        width(): Promise<number>;
        /** Keeps a new sidebar width in `config.json`. */
        setWidth(width: number): Promise<void>;
        /** Whether the user hid the sidebar (US-1.6.3). */
        collapsed(): Promise<boolean>;
        /** Keeps whether the sidebar is hidden in `config.json`. */
        setCollapsed(collapsed: boolean): Promise<void>;
    };
    readonly commands: {
        /** Calls `listener` with each menu command; returns a function that stops listening. */
        onCommand(listener: (command: AppCommand) => void): () => void;
    };
}

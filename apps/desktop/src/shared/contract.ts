import type { AccessibilityState, ScreenReaderMode } from './accessibility';
import type { DisplaySettings } from './display';
import type { KnownHost } from './hosts';
import type { CommandId } from './keymap';
import type { LinkCheck } from './links';

/** Requests the renderer makes of the main process with `ipcRenderer.invoke`: arguments and result per channel. */
export interface InvokeContract {
    readonly 'display:get': { readonly args: readonly []; readonly result: DisplaySettings };
    readonly 'accessibility:get': { readonly args: readonly []; readonly result: AccessibilityState };
    readonly 'accessibility:set-mode': { readonly args: readonly [mode: ScreenReaderMode]; readonly result: undefined };
    readonly 'hosts:list': { readonly args: readonly []; readonly result: readonly KnownHost[] };
    readonly 'hosts:add': { readonly args: readonly [address: string]; readonly result: KnownHost };
    readonly 'hosts:suggestions': { readonly args: readonly []; readonly result: readonly string[] };
    readonly 'hosts:remove': { readonly args: readonly [id: string]; readonly result: undefined };
    readonly 'hosts:set-install-root': {
        readonly args: readonly [id: string, installRoot: string];
        readonly result: KnownHost;
    };
    readonly 'links:check': { readonly args: readonly [target: string]; readonly result: LinkCheck | undefined };
    readonly 'links:open': {
        readonly args: readonly [target: string, trustOrigin: boolean];
        readonly result: undefined;
    };
    readonly 'menus:terminal': { readonly args: readonly [canCopy: boolean]; readonly result: undefined };
    readonly 'clipboard:write': { readonly args: readonly [text: string]; readonly result: undefined };
    readonly 'terminal:get-zoom': { readonly args: readonly []; readonly result: number };
    readonly 'terminal:set-zoom': { readonly args: readonly [zoom: number]; readonly result: undefined };
    readonly 'sidebar:get-width': { readonly args: readonly []; readonly result: number };
    readonly 'sidebar:set-width': { readonly args: readonly [width: number]; readonly result: undefined };
    readonly 'sidebar:get-collapsed': { readonly args: readonly []; readonly result: boolean };
    readonly 'sidebar:set-collapsed': { readonly args: readonly [collapsed: boolean]; readonly result: undefined };
}

/** One invoke channel. */
export type InvokeChannel = keyof InvokeContract;

/** The event the main process sends when the OS display settings change. */
export const DISPLAY_CHANGED_CHANNEL = 'display:changed';

/** The event the main process sends when assistive technology starts or stops using the app, or screen-reader mode changes. */
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
        /** Whether assistive technology such as VoiceOver is using the app, and the screen-reader mode. */
        get(): Promise<AccessibilityState>;
        /** Sets and keeps the screen-reader mode (A11Y-10.2). */
        setMode(mode: ScreenReaderMode): Promise<void>;
        /** Calls `listener` whenever either changes; returns a function that stops listening. */
        onChanged(listener: (state: AccessibilityState) => void): () => void;
    };
    readonly hosts: {
        /** The hosts the user added, in order. */
        list(): Promise<readonly KnownHost[]>;
        /** Adds a host from what the user typed; rejects an address ssh could not use. */
        add(address: string): Promise<KnownHost>;
        /** Addresses to offer: recent ones, then the SSH configuration's `Host` names (US-1.1.1). */
        suggestions(): Promise<readonly string[]>;
        /** Forgets a host (A11Y-11.9). */
        remove(id: string): Promise<void>;
        /** Moves a host's install location (US-1.4.3). */
        setInstallRoot(id: string, installRoot: string): Promise<KnownHost>;
    };
    readonly links: {
        /** The link as it would open, its origin, and whether a trusted prefix lets it open without asking. */
        check(target: string): Promise<LinkCheck | undefined>;
        /** Opens a link the user confirmed or trusts, first trusting its origin when asked (US-1.12.4). */
        open(target: string, trustOrigin: boolean): Promise<void>;
    };
    readonly clipboard: {
        /** Puts text a program wrote with OSC 52 on the clipboard, for a host that allows it (SEC-06.1). */
        write(text: string): Promise<void>;
    };
    readonly terminal: {
        /** The terminal text size the user last chose, in percent (A11Y-07.4). */
        zoom(): Promise<number>;
        /** Keeps a terminal text size in `config.json`. */
        setZoom(zoom: number): Promise<void>;
    };
    readonly menus: {
        /** Shows the terminal's context menu: Copy when `canCopy`, Paste, List Links and Look Up (A11Y-11.11). */
        terminal(canCopy: boolean): Promise<void>;
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

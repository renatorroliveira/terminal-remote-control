import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron';
import type { AccessibilityState } from '../shared/accessibility';
import { CONNECTION_PORT_CHANNEL, CONNECTION_PORT_MESSAGE } from '../shared/connection-port';
import {
    ACCESSIBILITY_CHANGED_CHANNEL,
    APP_COMMAND_CHANNEL,
    type AppCommand,
    DISPLAY_CHANGED_CHANNEL,
    type TrcBridge,
} from '../shared/contract';
import type { DisplaySettings } from '../shared/display';
import type { KnownHost } from '../shared/hosts';
import type { LinkCheck } from '../shared/links';
import type { Settings } from '../shared/settings';

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
    const handler = (_event: IpcRendererEvent, value: T): void => listener(value);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.off(channel, handler);
}

const bridge: TrcBridge = {
    platform: process.platform,
    display: {
        get: () => ipcRenderer.invoke('display:get') as Promise<DisplaySettings>,
        onChanged: (listener) => subscribe<DisplaySettings>(DISPLAY_CHANGED_CHANNEL, listener),
    },
    accessibility: {
        get: () => ipcRenderer.invoke('accessibility:get') as Promise<AccessibilityState>,
        setMode: (mode) => ipcRenderer.invoke('accessibility:set-mode', mode) as Promise<void>,
        onChanged: (listener) => subscribe<AccessibilityState>(ACCESSIBILITY_CHANGED_CHANNEL, listener),
    },
    hosts: {
        list: () => ipcRenderer.invoke('hosts:list') as Promise<readonly KnownHost[]>,
        add: (address) => ipcRenderer.invoke('hosts:add', address) as Promise<KnownHost>,
        suggestions: () => ipcRenderer.invoke('hosts:suggestions') as Promise<readonly string[]>,
        remove: (id) => ipcRenderer.invoke('hosts:remove', id) as Promise<void>,
        setInstallRoot: (id, installRoot) =>
            ipcRenderer.invoke('hosts:set-install-root', id, installRoot) as Promise<KnownHost>,
        setClipboardWrites: (id, allowed) =>
            ipcRenderer.invoke('hosts:set-clipboard-writes', id, allowed) as Promise<KnownHost>,
    },
    links: {
        check: (target) => ipcRenderer.invoke('links:check', target) as Promise<LinkCheck | undefined>,
        open: (target, trustOrigin) => ipcRenderer.invoke('links:open', target, trustOrigin) as Promise<void>,
    },
    clipboard: {
        write: (hostId, text) => ipcRenderer.invoke('clipboard:write', hostId, text) as Promise<boolean>,
    },
    menus: {
        terminal: (canCopy) => ipcRenderer.invoke('menus:terminal', canCopy) as Promise<void>,
        ignoreShortcuts: (ignore) => ipcRenderer.invoke('menus:ignore-shortcuts', ignore) as Promise<void>,
    },
    sidebar: {
        width: () => ipcRenderer.invoke('sidebar:get-width') as Promise<number>,
        setWidth: (width) => ipcRenderer.invoke('sidebar:set-width', width) as Promise<void>,
        collapsed: () => ipcRenderer.invoke('sidebar:get-collapsed') as Promise<boolean>,
        setCollapsed: (collapsed) => ipcRenderer.invoke('sidebar:set-collapsed', collapsed) as Promise<void>,
    },
    settings: {
        get: () => ipcRenderer.invoke('settings:get') as Promise<Settings>,
        set: (change) => ipcRenderer.invoke('settings:set', change) as Promise<void>,
    },
    help: {
        openGuide: (section) => ipcRenderer.invoke('help:open-guide', section) as Promise<void>,
    },
    commands: {
        onCommand: (listener) => subscribe<AppCommand>(APP_COMMAND_CHANNEL, listener),
    },
};

contextBridge.exposeInMainWorld('trc', bridge);

ipcRenderer.on(CONNECTION_PORT_CHANNEL, (event) => {
    window.postMessage({ type: CONNECTION_PORT_MESSAGE }, window.location.origin, [...event.ports]);
});

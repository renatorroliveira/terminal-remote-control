import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron';
import { CONNECTION_PORT_CHANNEL, CONNECTION_PORT_MESSAGE } from '../shared/connection-port';
import {
    ACCESSIBILITY_CHANGED_CHANNEL,
    APP_COMMAND_CHANNEL,
    type AppCommand,
    DISPLAY_CHANGED_CHANNEL,
    type TrcBridge,
} from '../shared/contract';
import type { DisplaySettings } from '../shared/display';

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
        get: () => ipcRenderer.invoke('accessibility:get') as Promise<boolean>,
        onChanged: (listener) => subscribe<boolean>(ACCESSIBILITY_CHANGED_CHANNEL, listener),
    },
    commands: {
        onCommand: (listener) => subscribe<AppCommand>(APP_COMMAND_CHANNEL, listener),
    },
};

contextBridge.exposeInMainWorld('trc', bridge);

ipcRenderer.on(CONNECTION_PORT_CHANNEL, (event) => {
    window.postMessage({ type: CONNECTION_PORT_MESSAGE }, window.location.origin, [...event.ports]);
});

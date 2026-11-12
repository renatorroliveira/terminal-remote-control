import { contextBridge, ipcRenderer } from 'electron';
import { CONNECTION_PORT_CHANNEL, CONNECTION_PORT_MESSAGE } from '../shared/connection-port';

/** The API the preload exposes to the renderer as `window.trc`. */
export interface TrcBridge {
    readonly platform: string;
}

const bridge: TrcBridge = { platform: process.platform };

contextBridge.exposeInMainWorld('trc', bridge);

ipcRenderer.on(CONNECTION_PORT_CHANNEL, (event) => {
    window.postMessage({ type: CONNECTION_PORT_MESSAGE }, window.location.origin, [...event.ports]);
});

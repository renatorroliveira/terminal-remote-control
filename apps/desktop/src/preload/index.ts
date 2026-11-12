import { contextBridge } from 'electron';

/** The API the preload exposes to the renderer as `window.trc`. */
export interface TrcBridge {
    readonly platform: string;
}

const bridge: TrcBridge = { platform: process.platform };

contextBridge.exposeInMainWorld('trc', bridge);

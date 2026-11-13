import { app, type BrowserWindow, MessageChannelMain, utilityProcess } from 'electron';
import connectionHostPath from '../connection-host/index?modulePath';
import { CONNECTION_HOST_NAME, CONNECTION_PORT_CHANNEL } from '../shared/connection-port';
import { connectionHostInit } from './connection-host-init';

/**
 * Starts the connection host and gives the window a fresh MessagePort to it after every page load, so a reload
 * reconnects to the same connections (TECH_STACK §4.2). `resources` holds the bundled daemons and helpers.
 */
export function startConnectionHost(window: BrowserWindow, resources: string): void {
    const child = utilityProcess.fork(connectionHostPath, [], { serviceName: CONNECTION_HOST_NAME });
    const init = connectionHostInit({
        userData: app.getPath('userData'),
        resources,
        appVersion: app.getVersion(),
        env: process.env,
        seamEnabled: __TRC_TEST_SEAM__,
    });
    let first = true;
    window.webContents.on('did-finish-load', () => {
        const { port1, port2 } = new MessageChannelMain();
        child.postMessage(first ? init : { type: 'port' }, [port1]);
        first = false;
        window.webContents.postMessage(CONNECTION_PORT_CHANNEL, null, [port2]);
    });
    app.on('before-quit', () => child.kill());
}

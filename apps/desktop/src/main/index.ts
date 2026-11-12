import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, protocol } from 'electron';
import { APP_IDENTITY } from '../shared/app-identity';
import { APP_COMMAND_CHANNEL } from '../shared/contract';
import { contentTypeFor, resolveAppRequest } from './app-protocol';
import { startConnectionHost } from './connection-host';
import { currentDisplaySettings, relayDisplaySettings } from './display-relay';
import { registerHandlers } from './ipc';
import { menuTemplate } from './menu';
import { CONTENT_SECURITY_POLICY, secureWebPreferences } from './security';
import { isAppPage } from './trusted-sender';

const rendererRoot = join(import.meta.dirname, '../renderer');
const devServer = process.env['ELECTRON_RENDERER_URL'];
let mainWindow: BrowserWindow | undefined;

protocol.registerSchemesAsPrivileged([
    { scheme: APP_IDENTITY.appScheme, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (app.requestSingleInstanceLock()) {
    app.on('second-instance', focusMainWindow);
    app.whenReady().then(start);
    app.on('window-all-closed', () => app.quit());
} else {
    app.quit();
}

function start(): void {
    protocol.handle(APP_IDENTITY.appScheme, serveAppRequest);
    registerHandlers(ipcMain, { 'display:get': async () => currentDisplaySettings() }, (event) =>
        isAppPage((event as Electron.IpcMainInvokeEvent).senderFrame?.url, devServer),
    );
    Menu.setApplicationMenu(
        Menu.buildFromTemplate(
            menuTemplate({
                appName: APP_IDENTITY.productName,
                onCommand: (command) => mainWindow?.webContents.send(APP_COMMAND_CHANNEL, command),
            }),
        ),
    );
    mainWindow = createWindow();
}

function focusMainWindow(): void {
    if (mainWindow === undefined || mainWindow.isDestroyed()) {
        return;
    }
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }
    mainWindow.focus();
}

async function serveAppRequest(request: Request): Promise<Response> {
    const file = resolveAppRequest(request.url, rendererRoot);
    if (file === undefined) {
        return new Response('Not found', { status: 404 });
    }
    const body = await readFile(file).catch(() => undefined);
    if (body === undefined) {
        return new Response('Not found', { status: 404 });
    }
    return new Response(body, {
        headers: { 'content-type': contentTypeFor(file), 'content-security-policy': CONTENT_SECURITY_POLICY },
    });
}

function createWindow(): BrowserWindow {
    const window = new BrowserWindow({
        width: 1200,
        height: 800,
        title: APP_IDENTITY.productName,
        webPreferences: secureWebPreferences(join(import.meta.dirname, '../preload/index.cjs')),
    });
    startConnectionHost(window);
    relayDisplaySettings(window);
    void window.loadURL(devServer ?? `${APP_IDENTITY.appScheme}://${APP_IDENTITY.appHost}/index.html`);
    return window;
}

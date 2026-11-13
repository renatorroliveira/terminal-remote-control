import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, protocol } from 'electron';
import { APP_IDENTITY } from '../shared/app-identity';
import { APP_COMMAND_CHANNEL } from '../shared/contract';
import { relayAccessibilitySupport } from './accessibility-relay';
import { contentTypeFor, resolveAppRequest } from './app-protocol';
import { type AppSettings, appSettingsStore } from './app-settings';
import { isBackgroundLaunch } from './background-launch';
import { startConnectionHost } from './connection-host';
import { DisplayRelay } from './display-relay';
import { registerHandlers } from './ipc';
import { menuTemplate } from './menu';
import { CONTENT_SECURITY_POLICY, secureWebPreferences } from './security';
import { isAppPage } from './trusted-sender';

const rendererRoot = join(import.meta.dirname, '../renderer');
const devServer = process.env['ELECTRON_RENDERER_URL'];
let mainWindow: BrowserWindow | undefined;
const background = isBackgroundLaunch({ seamEnabled: __TRC_TEST_SEAM__, env: process.env });

if (background && process.platform === 'darwin') {
    app.setActivationPolicy('accessory');
}

protocol.registerSchemesAsPrivileged([
    { scheme: APP_IDENTITY.appScheme, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (app.requestSingleInstanceLock()) {
    app.on('second-instance', focusMainWindow);
    void app.whenReady().then(start);
    app.on('window-all-closed', () => app.quit());
} else {
    app.quit();
}

async function start(): Promise<void> {
    protocol.handle(APP_IDENTITY.appScheme, serveAppRequest);
    const store = appSettingsStore(app.getPath('userData'));
    let settings: AppSettings = await store.read();
    const display = new DisplayRelay(settings.theme);
    registerHandlers(
        ipcMain,
        {
            'display:get': async () => display.current(),
            'accessibility:get': async () => app.isAccessibilitySupportEnabled(),
        },
        (event) => isAppPage((event as Electron.IpcMainInvokeEvent).senderFrame?.url, devServer),
    );
    Menu.setApplicationMenu(
        Menu.buildFromTemplate(
            menuTemplate({
                appName: APP_IDENTITY.productName,
                onCommand: (command) => mainWindow?.webContents.send(APP_COMMAND_CHANNEL, command),
                onLookUp: () => mainWindow?.webContents.showDefinitionForSelection(),
                themePreference: settings.theme,
                onThemePreference: (theme) => {
                    settings = { ...settings, theme };
                    display.setPreference(theme);
                    void store.write(settings);
                },
            }),
        ),
    );
    mainWindow = createWindow(display);
}

function focusMainWindow(): void {
    if (mainWindow === undefined || mainWindow.isDestroyed()) {
        return;
    }
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }
    if (background) {
        mainWindow.showInactive();
        return;
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

function createWindow(display: DisplayRelay): BrowserWindow {
    const window = new BrowserWindow({
        width: 1200,
        height: 800,
        title: APP_IDENTITY.productName,
        show: !background,
        webPreferences: secureWebPreferences(join(import.meta.dirname, '../preload/index.cjs')),
    });
    if (background) {
        window.once('ready-to-show', () => window.showInactive());
    }
    startConnectionHost(window);
    display.attach(window);
    relayAccessibilitySupport(window);
    void window.loadURL(devServer ?? `${APP_IDENTITY.appScheme}://${APP_IDENTITY.appHost}/index.html`);
    return window;
}

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, protocol, shell } from 'electron';
import { APP_IDENTITY } from '../shared/app-identity';
import { APP_COMMAND_CHANNEL } from '../shared/contract';
import type { ThemePreference } from '../shared/display';
import { resolveKeymap } from '../shared/keymap';
import { aboutPanelOptions } from './about-panel';
import { relayAccessibility } from './accessibility-relay';
import { AppConfigFile } from './app-config';
import { appIconPath } from './app-icon';
import { contentTypeFor, resolveAppRequest } from './app-protocol';
import { isBackgroundLaunch } from './background-launch';
import { startConnectionHost } from './connection-host';
import { DisplayRelay } from './display-relay';
import { suggestedAddresses } from './host-suggestions';
import { installRootFor } from './install-root';
import { type InvokeHandlers, registerHandlers } from './ipc';
import { KnownHosts } from './known-hosts';
import { migrateLegacyState } from './legacy-state';
import { LinkService } from './link-service';
import { type MenuOptions, menuTemplate, terminalContextMenu } from './menu';
import { openExternalFor } from './open-external';
import { ScreenReaderSetting, screenReaderFlag } from './screen-reader-mode';
import { CONTENT_SECURITY_POLICY, secureWebPreferences } from './security';
import { sshConfigFilesFor, sshConfigHosts } from './ssh-config-hosts';
import { trcHome } from './trc-home';
import { isAppPage } from './trusted-sender';

const rendererRoot = join(import.meta.dirname, '../renderer');
const resources = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
const devServer = process.env['ELECTRON_RENDERER_URL'];
let mainWindow: BrowserWindow | undefined;
const background = isBackgroundLaunch({ seamEnabled: __TRC_TEST_SEAM__, env: process.env });

if (background && process.platform === 'darwin') {
    app.setActivationPolicy('accessory');
}

app.setAboutPanelOptions(aboutPanelOptions({ version: app.getVersion(), commit: __TRC_BUILD_COMMIT__ }));

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
    if (!app.isPackaged && !background) {
        app.dock?.setIcon(appIconPath(resources));
    }
    const home = trcHome(process.env, app.getPath('home'));
    await migrateLegacyState({ appData: app.getPath('appData'), home });
    const config = new AppConfigFile(home);
    const { theme, screenReaderMode } = await config.read();
    const display = new DisplayRelay(theme);
    const screenReader = new ScreenReaderSetting({
        stored: screenReaderMode,
        flag: screenReaderFlag(process.argv),
        supportEnabled: () => app.isAccessibilitySupportEnabled(),
        save: (mode) => config.update({ screenReaderMode: mode }),
    });
    const knownHosts = new KnownHosts(home);
    const links = new LinkService(
        home,
        openExternalFor({
            seamEnabled: __TRC_TEST_SEAM__,
            env: process.env,
            shellOpen: (url) => shell.openExternal(url),
        }),
    );
    registerHandlers(
        ipcMain,
        {
            'display:get': async () => display.current(),
            'accessibility:get': async () => screenReader.current(),
            'accessibility:set-mode': async (mode) => {
                await screenReader.setMode(mode);
                return undefined;
            },
            'menus:terminal': async (canCopy) => {
                const menu = Menu.buildFromTemplate(terminalContextMenu(menuActions(), canCopy));
                menu.popup(mainWindow === undefined ? {} : { window: mainWindow });
                return undefined;
            },
            'links:check': (target) => links.check(target),
            'links:open': async (target, trustOrigin) => {
                await links.open(target, trustOrigin);
                return undefined;
            },
            ...hostHandlers(knownHosts),
            ...sidebarHandlers(config),
        },
        (event) => isAppPage((event as Electron.IpcMainInvokeEvent).senderFrame?.url, devServer),
    );
    installMenu(display, config, theme);
    mainWindow = createWindow(display, screenReader);
}

type HostHandlers = Pick<
    InvokeHandlers,
    'hosts:list' | 'hosts:add' | 'hosts:suggestions' | 'hosts:remove' | 'hosts:set-install-root'
>;

function hostHandlers(knownHosts: KnownHosts): HostHandlers {
    const home = app.getPath('home');
    const installRoot = installRootFor({ seamEnabled: __TRC_TEST_SEAM__, env: process.env });
    const sshConfigFiles = sshConfigFilesFor({ seamEnabled: __TRC_TEST_SEAM__, env: process.env, home });
    return {
        'hosts:list': () => knownHosts.list(),
        'hosts:add': (address) => knownHosts.add(address, installRoot),
        'hosts:suggestions': async () =>
            suggestedAddresses(
                await knownHosts.recent(),
                await sshConfigHosts(sshConfigFiles, home),
                await knownHosts.list(),
            ),
        'hosts:remove': async (id) => {
            await knownHosts.remove(id);
            return undefined;
        },
        'hosts:set-install-root': (id, root) => knownHosts.setInstallRoot(id, root),
    };
}

type SidebarHandlers = Pick<
    InvokeHandlers,
    'sidebar:get-width' | 'sidebar:set-width' | 'sidebar:get-collapsed' | 'sidebar:set-collapsed'
>;

function sidebarHandlers(config: AppConfigFile): SidebarHandlers {
    return {
        'sidebar:get-width': async () => (await config.read()).sidebarWidth,
        'sidebar:set-width': async (width) => {
            await config.update({ sidebarWidth: width });
            return undefined;
        },
        'sidebar:get-collapsed': async () => (await config.read()).sidebarCollapsed,
        'sidebar:set-collapsed': async (collapsed) => {
            await config.update({ sidebarCollapsed: collapsed });
            return undefined;
        },
    };
}

function installMenu(display: DisplayRelay, config: AppConfigFile, theme: ThemePreference): void {
    Menu.setApplicationMenu(
        Menu.buildFromTemplate(
            menuTemplate({
                ...menuActions(),
                appName: APP_IDENTITY.productName,
                themePreference: theme,
                onThemePreference: (preference) => {
                    display.setPreference(preference);
                    void config.update({ theme: preference });
                },
            }),
        ),
    );
}

function menuActions(): Pick<MenuOptions, 'keymap' | 'onCommand' | 'onLookUp'> {
    return {
        keymap: resolveKeymap({}),
        onCommand: (command) => mainWindow?.webContents.send(APP_COMMAND_CHANNEL, command),
        onLookUp: () => mainWindow?.webContents.showDefinitionForSelection(),
    };
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

function createWindow(display: DisplayRelay, screenReader: ScreenReaderSetting): BrowserWindow {
    const window = new BrowserWindow({
        width: 1200,
        height: 800,
        title: APP_IDENTITY.productName,
        icon: appIconPath(resources),
        show: !background,
        webPreferences: secureWebPreferences(join(import.meta.dirname, '../preload/index.cjs')),
    });
    if (background) {
        window.once('ready-to-show', () => window.showInactive());
    }
    startConnectionHost(window, resources);
    display.attach(window);
    relayAccessibility(window, screenReader);
    void window.loadURL(devServer ?? `${APP_IDENTITY.appScheme}://${APP_IDENTITY.appHost}/index.html`);
    return window;
}

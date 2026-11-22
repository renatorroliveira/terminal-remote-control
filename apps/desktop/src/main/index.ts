import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, clipboard, ipcMain, Menu, Notification, protocol, screen, session, shell } from 'electron';
import { APP_IDENTITY } from '../shared/app-identity';
import { APP_COMMAND_CHANNEL, NOTIFICATION_CHOSEN_CHANNEL, QUIT_REQUESTED_CHANNEL } from '../shared/contract';
import type { ThemePreference } from '../shared/display';
import { type Keymap, UNBOUND_KEYMAP } from '../shared/keymap';
import { keymapFor } from '../shared/settings';
import { windowsTrcd } from '../shared/windows-helper';
import { aboutPanelOptions } from './about-panel';
import { relayAccessibility } from './accessibility-relay';
import { AppConfigFile, settingsOf } from './app-config';
import { appIconPath } from './app-icon';
import { contentTypeFor, resolveAppRequest } from './app-protocol';
import { backgroundWindowOptions, showInBackground } from './background-window';
import { writeHostClipboard } from './clipboard-writes';
import { startConnectionHost } from './connection-host';
import { refuseRemoteDebugging } from './debugging-guard';
import { DisplayRelay } from './display-relay';
import { GuideWindow } from './guide-window';
import { suggestedAddresses } from './host-suggestions';
import { installRootFor } from './install-root';
import { type InvokeHandlers, registerHandlers } from './ipc';
import { KnownHosts } from './known-hosts';
import { tuneInputLatency } from './latency-switches';
import { migrateLegacyState } from './legacy-state';
import { LinkService } from './link-service';
import { localHostRoot } from './local-host';
import { type MenuOptions, menuTemplate, terminalContextMenu } from './menu';
import { refuseNavigation } from './navigation-guard';
import { disableNetworkSwitches, lockDownNetwork } from './network-guard';
import { openExternalFor } from './open-external';
import { OsNotifications } from './os-notifications';
import { Pacer } from './pacer';
import { makeFoldersPrivate } from './private-folders';
import { QuitGuard } from './quit-guard';
import { ScreenReaderSetting, screenReaderFlag } from './screen-reader-mode';
import { CONTENT_SECURITY_POLICY, GUIDE_CONTENT_SECURITY_POLICY, secureWebPreferences } from './security';
import { SessionCacheFile } from './session-cache';
import { sshConfigFilesFor, sshConfigHosts } from './ssh-config-hosts';
import { NO_TEST_SEAM } from './test-seam';
import { readTestSeam } from './test-seam-reader';
import { trcHome } from './trc-home';
import { isAppPage } from './trusted-sender';

refuseRemoteDebugging(app.commandLine, { testBuild: __TRC_TEST_SEAM__ });
disableNetworkSwitches(app.commandLine);
tuneInputLatency(app.commandLine);

const rendererRoot = join(import.meta.dirname, '../renderer');
const resources = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
const appRoots = { [APP_IDENTITY.appHost]: rendererRoot, [APP_IDENTITY.docsHost]: join(resources, 'docs') };
const devServer = process.env['ELECTRON_RENDERER_URL'];
let mainWindow: BrowserWindow | undefined;
let keymap: Keymap = keymapFor({ shortcuts: {}, plainF6: false });
/** Whether the settings page records a shortcut, so the menus give up theirs (A11Y-05.7). */
let recordingShortcut = false;
/** Copy last command output is a user's command; a page asking faster than this is refused (SEC-06). */
const copies = new Pacer(500);
const testSeam = __TRC_TEST_SEAM__ ? readTestSeam(process.env) : NO_TEST_SEAM;
const background = testSeam.background;

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
    lockDownPages();
    protocol.handle(APP_IDENTITY.appScheme, serveAppRequest);
    if (!app.isPackaged && !background) {
        app.dock?.setIcon(appIconPath(resources));
    }
    const home = trcHome(process.env, app.getPath('home'));
    await keepPrivate([home, app.getPath('userData')]);
    await migrateLegacyState({ appData: app.getPath('appData'), home });
    const config = new AppConfigFile(home);
    const stored = await config.read();
    const { theme, screenReaderMode } = stored;
    keymap = keymapFor(stored);
    const display = new DisplayRelay(theme);
    const screenReader = new ScreenReaderSetting({
        stored: screenReaderMode,
        flag: screenReaderFlag(process.argv),
        supportEnabled: () => app.isAccessibilitySupportEnabled(),
        save: (mode) => config.update({ screenReaderMode: mode }),
    });
    const localRoot = localHostRoot({ platform: process.platform, testBuild: __TRC_TEST_SEAM__, seam: testSeam, home });
    const knownHosts = new KnownHosts(home, localRoot === undefined ? {} : { localRoot });
    const osNotifications = new OsNotifications({
        supported: () => Notification.isSupported(),
        create: (options) => new Notification(options),
        onClick: (key) => {
            focusMainWindow();
            mainWindow?.webContents.send(NOTIFICATION_CHOSEN_CHANNEL, key);
        },
    });
    const quitGuard = guardQuitting(config, stored.quitNoticeShown);
    registerHandlers(
        ipcMain,
        {
            'display:get': async () => display.current(),
            'accessibility:get': async () => screenReader.current(),
            'accessibility:set-mode': async (mode) => {
                await screenReader.setMode(mode);
                return undefined;
            },
            ...menuHandlers(display, config),
            'clipboard:write': (hostId, text) =>
                writeHostClipboard(
                    { hosts: () => knownHosts.list(), writeText: (written) => clipboard.writeText(written) },
                    hostId,
                    text,
                ),
            'notifications:post': async (notice) => osNotifications.post(notice),
            'clipboard:copy': async (text) => {
                if (!copies.allow()) {
                    return false;
                }
                clipboard.writeText(text);
                return true;
            },
            ...linkHandlers(home),
            ...hostHandlers(knownHosts),
            ...sidebarHandlers(config),
            ...settingsHandlers(config, display),
            ...sessionHandlers(new SessionCacheFile(home)),
            ...quitHandlers(quitGuard),
        },
        (event) => isAppPage((event as Electron.IpcMainInvokeEvent).senderFrame?.url, devServer),
    );
    installMenu(display, config, theme);
    mainWindow = createWindow(display, screenReader, localRoot);
    mainWindow.on('close', (event) => quitGuard.beforeQuit(event));
}

/**
 * Holds the first quit while sessions may run, so the page can show the first-quit notice (US-2.1.5): on
 * `before-quit`, and on closing the window, which quits the app.
 */
/** Makes the TRC home and the app's data folder private to the user (SEC-05, D-68), warning about any it cannot. */
async function keepPrivate(folders: readonly string[]): Promise<void> {
    const trcd = windowsTrcd(resources, process.arch);
    for (const folder of await makeFoldersPrivate(folders, { platform: process.platform, trcd })) {
        console.warn(`TRC could not make ${folder} private to this user`);
    }
}

function guardQuitting(config: AppConfigFile, noticeShown: boolean): QuitGuard {
    const guard = new QuitGuard({
        noticeShown,
        markShown: () => void config.update({ quitNoticeShown: true }),
        ask: () => {
            const contents = mainWindow?.isDestroyed() === false ? mainWindow.webContents : undefined;
            contents?.send(QUIT_REQUESTED_CHANNEL);
            return contents !== undefined && !contents.isCrashed();
        },
        quit: () => app.quit(),
    });
    app.on('before-quit', (event) => guard.beforeQuit(event));
    return guard;
}

/** Quits as the page decides, and keeps that it showed the first-quit notice (US-2.1). */
function quitHandlers(guard: QuitGuard): Pick<InvokeHandlers, 'app:quit' | 'app:quit-notice-opened'> {
    return {
        'app:quit': async () => {
            guard.quit();
            return undefined;
        },
        'app:quit-notice-opened': async () => {
            guard.noticeOpened();
            return undefined;
        },
    };
}

type HostHandlers = Pick<
    InvokeHandlers,
    | 'hosts:list'
    | 'hosts:add'
    | 'hosts:suggestions'
    | 'hosts:remove'
    | 'hosts:set-install-root'
    | 'hosts:set-clipboard-writes'
    | 'hosts:set-daemon-removed'
    | 'hosts:set-shell-integration'
>;

/** Checks and opens links (US-1.12.3, US-1.12.4), and opens the user guide in its own window (A11Y-10.4). */
function linkHandlers(home: string): Pick<InvokeHandlers, 'links:check' | 'links:open' | 'help:open-guide'> {
    const openExternal = openExternalFor({
        openedLinks: testSeam.openedLinks,
        shellOpen: (url) => shell.openExternal(url),
    });
    const links = new LinkService(home, openExternal);
    const guide = new GuideWindow({ icon: appIconPath(resources), openExternal, background });
    return {
        'links:check': (target) => links.check(target),
        'links:open': async (target, trustOrigin) => {
            await links.open(target, trustOrigin);
            return undefined;
        },
        'help:open-guide': async (section) => {
            guide.open(section);
            return undefined;
        },
    };
}

/** Reads and keeps each host's sessions as last listed (US-2.3.2, P-30). */
function sessionHandlers(cache: SessionCacheFile): Pick<InvokeHandlers, 'sessions:load' | 'sessions:save'> {
    return {
        'sessions:load': () => cache.read(),
        'sessions:save': async (sessions) => {
            await cache.write(sessions);
            return undefined;
        },
    };
}

/** Keeps every page off the network and denies it every permission (SEC-01.1, SEC-06). */
function lockDownPages(): void {
    const pages = session.defaultSession;
    lockDownNetwork({
        configureHostResolver: (options) => app.configureHostResolver(options),
        onWebContentsCreated: (listener) => app.on('web-contents-created', (_event, contents) => listener(contents)),
        denyPermissionRequests: (handler) =>
            pages.setPermissionRequestHandler((_contents, permission, grant) => handler(permission, grant)),
        denyPermissionChecks: (handler) =>
            pages.setPermissionCheckHandler((_contents, permission) => handler(permission)),
        denyDevicePermissions: (handler) => pages.setDevicePermissionHandler(handler),
    });
}

function hostHandlers(knownHosts: KnownHosts): HostHandlers {
    const home = app.getPath('home');
    const installRoot = installRootFor(testSeam.installRoot);
    const sshConfigFiles = sshConfigFilesFor({ testConfig: testSeam.sshConfig, home });
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
        'hosts:set-clipboard-writes': (id, allowed) => knownHosts.setClipboardWrites(id, allowed),
        'hosts:set-daemon-removed': (id, removed) => knownHosts.setDaemonRemoved(id, removed),
        'hosts:set-shell-integration': (id, on) => knownHosts.setShellIntegration(id, on),
    };
}

type MenuHandlers = Pick<InvokeHandlers, 'menus:terminal' | 'menus:ignore-shortcuts'>;

function menuHandlers(display: DisplayRelay, config: AppConfigFile): MenuHandlers {
    return {
        'menus:terminal': async (canCopy) => {
            const menu = Menu.buildFromTemplate(terminalContextMenu(menuActions(), canCopy));
            menu.popup(mainWindow === undefined ? {} : { window: mainWindow });
            return undefined;
        },
        'menus:ignore-shortcuts': async (ignore) => {
            recordingShortcut = ignore;
            installMenu(display, config, (await config.read()).theme);
            return undefined;
        },
    };
}

type SettingsHandlers = Pick<InvokeHandlers, 'settings:get' | 'settings:set'>;

function settingsHandlers(config: AppConfigFile, display: DisplayRelay): SettingsHandlers {
    return {
        'settings:get': async () => settingsOf(await config.read()),
        'settings:set': async (change) => {
            await config.update(change);
            if (change.theme !== undefined) {
                display.setPreference(change.theme);
            }
            if (change.theme !== undefined || change.shortcuts !== undefined || change.plainF6 !== undefined) {
                const settings = await config.read();
                keymap = keymapFor(settings);
                installMenu(display, config, settings.theme);
            }
            return undefined;
        },
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
        keymap: recordingShortcut ? UNBOUND_KEYMAP : keymap,
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
        showInBackground(mainWindow);
        return;
    }
    mainWindow.focus();
}

async function serveAppRequest(request: Request): Promise<Response> {
    const file = resolveAppRequest(request.url, appRoots);
    if (file === undefined) {
        return new Response('Not found', { status: 404 });
    }
    const body = await readFile(file).catch(() => undefined);
    if (body === undefined) {
        return new Response('Not found', { status: 404 });
    }
    return new Response(body, {
        headers: { 'content-type': contentTypeFor(file), 'content-security-policy': policyFor(request.url) },
    });
}

function createWindow(
    display: DisplayRelay,
    screenReader: ScreenReaderSetting,
    localRoot: string | undefined,
): BrowserWindow {
    const size = { width: 1200, height: 800 };
    const window = new BrowserWindow({
        ...(background ? backgroundWindowOptions(screen.getPrimaryDisplay().workArea, size) : size),
        title: APP_IDENTITY.productName,
        icon: appIconPath(resources),
        show: !background,
        webPreferences: secureWebPreferences(join(import.meta.dirname, '../preload/index.cjs')),
    });
    if (background) {
        window.once('ready-to-show', () => showInBackground(window));
    }
    refuseNavigation(window.webContents);
    startConnectionHost(window, resources, testSeam, localRoot);
    display.attach(window);
    relayAccessibility(window, screenReader);
    void window.loadURL(devServer ?? `${APP_IDENTITY.appScheme}://${APP_IDENTITY.appHost}/index.html`);
    return window;
}

function policyFor(url: string): string {
    return new URL(url).host === APP_IDENTITY.docsHost ? GUIDE_CONTENT_SECURITY_POLICY : CONTENT_SECURITY_POLICY;
}

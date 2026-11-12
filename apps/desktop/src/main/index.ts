import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, protocol } from 'electron';
import { APP_IDENTITY } from '../shared/app-identity';
import { contentTypeFor, resolveAppRequest } from './app-protocol';
import { startConnectionHost } from './connection-host';
import { CONTENT_SECURITY_POLICY, secureWebPreferences } from './security';

const rendererRoot = join(import.meta.dirname, '../renderer');

protocol.registerSchemesAsPrivileged([
    { scheme: APP_IDENTITY.appScheme, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

app.whenReady().then(() => {
    protocol.handle(APP_IDENTITY.appScheme, serveAppRequest);
    createWindow();
});

app.on('window-all-closed', () => app.quit());

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

function createWindow(): void {
    const window = new BrowserWindow({
        width: 1200,
        height: 800,
        title: APP_IDENTITY.productName,
        webPreferences: secureWebPreferences(join(import.meta.dirname, '../preload/index.cjs')),
    });
    startConnectionHost(window);
    const devServer = process.env['ELECTRON_RENDERER_URL'];
    void window.loadURL(devServer ?? `${APP_IDENTITY.appScheme}://${APP_IDENTITY.appHost}/index.html`);
}

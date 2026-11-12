const { app, BrowserWindow, protocol, ipcMain, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const root = __dirname;
const args = Object.fromEntries(process.argv.filter((a) => a.startsWith('--s2-')).map((a) => a.slice(5).split('=')));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };
const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'";

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true } }]);

let child;
function startFlood(sender, command) {
    child?.kill('SIGKILL');
    child = spawn('/bin/sh', ['-c', command], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.on('data', (chunk) => sender.send('data', chunk));
}

app.whenReady().then(() => {
    if (args.ax === 'on') app.setAccessibilitySupportEnabled(true);
    protocol.handle('app', (request) => {
        const file = path.normalize(path.join(root, decodeURIComponent(new URL(request.url).pathname)));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return new Response('not found', { status: 404 });
        return new Response(fs.readFileSync(file), {
            headers: { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'content-security-policy': csp },
        });
    });
    const win = new BrowserWindow({
        width: 1100,
        height: 760,
        title: 'S2 ATS spike',
        webPreferences: { backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false, preload: path.join(root, 'preload.cjs') },
    });
    const query = new URLSearchParams({ variant: args.variant ?? 'editcontext', cadence: args.cadence ?? 'auto', auto: args.auto ?? '', at: args.ax ?? 'off', cap: args.cap ?? '5000', hold: args.hold ?? 'on', scenario: args.scenario ?? '', atscolor: args.atscolor ?? '', desc: args.desc ?? '' });
    win.loadURL(`app://spike/index.html?${query}`);
    Menu.setApplicationMenu(
        Menu.buildFromTemplate([
            { role: 'appMenu', submenu: [{ role: 'services' }, { type: 'separator' }, { role: 'quit' }] },
            { role: 'editMenu' },
            { label: 'Spike', submenu: [{ label: 'Look Up', accelerator: 'Ctrl+Cmd+D', click: () => win.webContents.showDefinitionForSelection() }] },
        ]),
    );
    ipcMain.on('flood', (event, command) => startFlood(event.sender, command));
    ipcMain.on('pause', () => child?.stdout.pause());
    ipcMain.on('resume', () => child?.stdout.resume());
    ipcMain.on('stop', () => child?.kill('SIGKILL'));
    ipcMain.on('type', (_event, text) => {
        for (const ch of text) {
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: ch });
            win.webContents.sendInputEvent({ type: 'char', keyCode: ch });
            win.webContents.sendInputEvent({ type: 'keyUp', keyCode: ch });
        }
    });
    ipcMain.on('report', (_event, report) => {
        process.stdout.write(`S2REPORT ${JSON.stringify(report)}\n`);
        if (args.auto) app.quit();
        win.focus();
    });
    process.stdout.write(`S2PID ${process.pid}\n`);
});
app.on('window-all-closed', () => app.quit());

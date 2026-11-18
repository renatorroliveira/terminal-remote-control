import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { type InvokeHandlers, registerHandlers } from './ipc';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function fakeIpc() {
    const handlers = new Map<string, Handler>();
    return { handlers, ipc: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) } };
}

const trusted = () => true;

function handlers(display: unknown = {}): InvokeHandlers {
    return {
        'display:get': async () => display as never,
        'accessibility:get': async () => ({ supportEnabled: true, mode: 'auto' }),
        'accessibility:set-mode': async () => undefined,
        'hosts:list': async () => [],
        'hosts:add': async () => ({
            id: 'host-0000000000000000',
            address: { destination: 'x' },
            installRoot: '~/.trc',
        }),
        'hosts:suggestions': async () => ['build'],
        'hosts:remove': async () => undefined,
        'hosts:set-install-root': async () => ({
            id: 'host-0000000000000000',
            address: { destination: 'x' },
            installRoot: '/scratch/trc',
        }),
        'links:check': async (target) => ({ target, origin: undefined, trusted: false }),
        'links:open': async () => undefined,
        'menus:terminal': async () => undefined,
        'clipboard:write': async () => true,
        'clipboard:copy': async () => true,
        'notifications:post': async () => true,
        'sidebar:get-width': async () => 400,
        'sidebar:set-width': async () => undefined,
        'sidebar:get-collapsed': async () => false,
        'sidebar:set-collapsed': async () => undefined,
        'help:open-guide': async () => undefined,
        'app:quit': async () => undefined,
        'app:quit-notice-opened': async () => undefined,
        'sessions:load': async () => ({}),
        'sessions:save': async () => undefined,
        'menus:ignore-shortcuts': async () => undefined,
        'settings:get': async () => DEFAULT_SETTINGS,
        'settings:set': async () => undefined,
        'hosts:set-clipboard-writes': async (id, allowed) => ({
            id,
            address: { destination: 'x' },
            installRoot: '~/.trc',
            ...(allowed ? { allowClipboardWrites: true } : {}),
        }),
        'hosts:set-daemon-removed': async (id, removed) => ({
            id,
            address: { destination: 'x' },
            installRoot: '~/.trc',
            ...(removed ? { daemonRemoved: true } : {}),
        }),
        'hosts:set-shell-integration': async (id, on) => ({
            id,
            address: { destination: 'x' },
            installRoot: '~/.trc',
            ...(on ? {} : { shellIntegrationOff: true }),
        }),
    };
}

describe('registerHandlers (zod at the renderer boundary)', () => {
    it('answers valid requests', async () => {
        const { handlers: registered, ipc } = fakeIpc();
        registerHandlers(ipc, handlers({ colorScheme: 'dark' }), trusted);
        expect(await registered.get('display:get')?.({})).toEqual({ colorScheme: 'dark' });
        expect(await registered.get('accessibility:get')?.({})).toEqual({ supportEnabled: true, mode: 'auto' });
        await expect(registered.get('accessibility:set-mode')?.({}, 'on')).resolves.toBeUndefined();
    });

    it('rejects requests with arguments the contract does not allow', async () => {
        const { handlers: registered, ipc } = fakeIpc();
        registerHandlers(ipc, handlers(), trusted);
        await expect(async () => registered.get('display:get')?.({}, 'unexpected')).rejects.toThrow(
            /invalid arguments/,
        );
        await expect(async () => registered.get('accessibility:get')?.({}, 1)).rejects.toThrow(/invalid arguments/);
        await expect(async () => registered.get('accessibility:set-mode')?.({}, 'loud')).rejects.toThrow(
            /invalid arguments/,
        );
        await expect(async () => registered.get('links:open')?.({}, 'https://example.com')).rejects.toThrow(
            /invalid arguments/,
        );
        await expect(async () =>
            registered.get('clipboard:write')?.({}, 'host-0000000000000000', 'x'.repeat(1_048_577)),
        ).rejects.toThrow(/invalid arguments/);
        await expect(async () => registered.get('clipboard:copy')?.({}, 'x'.repeat(16_777_217))).rejects.toThrow(
            /invalid arguments/,
        );
        await expect(async () => registered.get('links:check')?.({}, 'x'.repeat(9_000))).rejects.toThrow(
            /invalid arguments/,
        );
    });

    it('rejects host and sidebar requests with arguments the contract does not allow', async () => {
        const { handlers: registered, ipc } = fakeIpc();
        registerHandlers(ipc, handlers(), trusted);
        await expect(async () => registered.get('hosts:add')?.({}, 'devbox-1', '~/.trc')).rejects.toThrow(
            /invalid arguments/,
        );
        await expect(async () => registered.get('hosts:remove')?.({}, '../hosts')).rejects.toThrow(/invalid arguments/);
        await expect(async () =>
            registered.get('hosts:set-install-root')?.({}, 'host-0000000000000000'),
        ).rejects.toThrow(/invalid arguments/);
        await expect(async () => registered.get('sidebar:set-collapsed')?.({}, 'yes')).rejects.toThrow(
            /invalid arguments/,
        );
        await expect(async () =>
            registered.get('sessions:save')?.({}, { 'host-0123456789abcdef': [{ id: 'a', cwd: '/' }] }),
        ).rejects.toThrow(/invalid arguments/);
        for (const width of [299, 801, 400.5, '400']) {
            await expect(async () => registered.get('sidebar:set-width')?.({}, width)).rejects.toThrow(
                /invalid arguments/,
            );
        }
    });
});

describe('registerHandlers: hosts, sidebar and trust', () => {
    it('adds a host by address alone, and takes sidebar widths from 300 to 800 px', async () => {
        const { handlers: registered, ipc } = fakeIpc();
        registerHandlers(ipc, handlers(), trusted);
        expect(await registered.get('hosts:add')?.({}, 'devbox-1')).toMatchObject({ installRoot: '~/.trc' });
        expect(await registered.get('sidebar:get-width')?.({})).toBe(400);
        await expect(registered.get('sidebar:set-width')?.({}, 300)).resolves.toBeUndefined();
        expect(await registered.get('sidebar:get-collapsed')?.({})).toBe(false);
        await expect(registered.get('sidebar:set-collapsed')?.({}, true)).resolves.toBeUndefined();
    });

    it('opens the user guide at a known section only (A11Y-10.4)', async () => {
        const { handlers: registered, ipc } = fakeIpc();
        registerHandlers(ipc, handlers(), trusted);
        await expect(registered.get('help:open-guide')?.({}, undefined)).resolves.toBeUndefined();
        await expect(registered.get('help:open-guide')?.({}, 'voiceover')).resolves.toBeUndefined();
        await expect(async () => registered.get('help:open-guide')?.({}, '../secret')).rejects.toThrow(
            /invalid arguments/,
        );
    });

    it('takes a settings change only with known settings in range (A11Y-10.3)', async () => {
        const { handlers: registered, ipc } = fakeIpc();
        registerHandlers(ipc, handlers(), trusted);
        expect(await registered.get('settings:get')?.({})).toEqual(DEFAULT_SETTINGS);
        await expect(
            registered.get('settings:set')?.({}, { floodThreshold: 40, hints: false }),
        ).resolves.toBeUndefined();
        await expect(
            registered.get('settings:set')?.({}, { shortcuts: { 'terminal.find': 'Ctrl+Cmd+G' }, plainF6: true }),
        ).resolves.toBeUndefined();
        for (const change of [
            { floodThreshold: 4 },
            { theme: 'neon' },
            { sidebarWidth: 300 },
            { hints: undefined },
            { shortcuts: { 'no.such': 'F2' } },
            { shortcuts: { 'terminal.find': 'x'.repeat(65) } },
        ]) {
            await expect(async () => registered.get('settings:set')?.({}, change)).rejects.toThrow(/invalid arguments/);
        }
        await expect(
            registered.get('hosts:set-clipboard-writes')?.({}, 'host-0000000000000000', true),
        ).resolves.toEqual(expect.objectContaining({ allowClipboardWrites: true }));
        await expect(async () => registered.get('hosts:set-clipboard-writes')?.({}, 'host-0', true)).rejects.toThrow(
            /invalid arguments/,
        );
    });

    it('rejects requests from a page that is not the app', async () => {
        const { handlers: registered, ipc } = fakeIpc();
        registerHandlers(ipc, handlers(), () => false);
        await expect(async () => registered.get('display:get')?.({})).rejects.toThrow(/untrusted sender/);
    });
});

describe('registerHandlers: This computer (US-4.2.1)', () => {
    it('takes This computer for the per-host settings and clipboard, but never forgets or moves it (US-4.2.2)', async () => {
        const { handlers: registered, ipc } = fakeIpc();
        registerHandlers(ipc, handlers(), trusted);
        await expect(registered.get('hosts:set-clipboard-writes')?.({}, 'local', true)).resolves.toEqual(
            expect.objectContaining({ id: 'local', allowClipboardWrites: true }),
        );
        await expect(registered.get('hosts:set-daemon-removed')?.({}, 'local', true)).resolves.toEqual(
            expect.objectContaining({ id: 'local', daemonRemoved: true }),
        );
        await expect(registered.get('clipboard:write')?.({}, 'local', 'x')).resolves.toBe(true);
        await expect(
            registered.get('sessions:save')?.(
                {},
                { local: [{ id: '0123456789abcdef', shell: 'zsh', order: 0, state: 'running' }] },
            ),
        ).resolves.toBeUndefined();
        await expect(async () => registered.get('hosts:remove')?.({}, 'local')).rejects.toThrow(/invalid arguments/);
        await expect(async () => registered.get('hosts:set-install-root')?.({}, 'local', '/x')).rejects.toThrow(
            /invalid arguments/,
        );
    });
});

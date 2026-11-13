import { describe, expect, it } from 'vitest';
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
        'accessibility:get': async () => true,
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
        'sidebar:get-width': async () => 400,
        'sidebar:set-width': async () => undefined,
        'sidebar:get-collapsed': async () => false,
        'sidebar:set-collapsed': async () => undefined,
    };
}

describe('registerHandlers (zod at the renderer boundary)', () => {
    it('answers valid requests', async () => {
        const { handlers: registered, ipc } = fakeIpc();
        registerHandlers(ipc, handlers({ colorScheme: 'dark' }), trusted);
        expect(await registered.get('display:get')?.({})).toEqual({ colorScheme: 'dark' });
        expect(await registered.get('accessibility:get')?.({})).toBe(true);
    });

    it('rejects requests with arguments the contract does not allow', async () => {
        const { handlers: registered, ipc } = fakeIpc();
        registerHandlers(ipc, handlers(), trusted);
        await expect(async () => registered.get('display:get')?.({}, 'unexpected')).rejects.toThrow(
            /invalid arguments/,
        );
        await expect(async () => registered.get('accessibility:get')?.({}, 1)).rejects.toThrow(/invalid arguments/);
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
        for (const width of [299, 801, 400.5, '400']) {
            await expect(async () => registered.get('sidebar:set-width')?.({}, width)).rejects.toThrow(
                /invalid arguments/,
            );
        }
    });

    it('adds a host by address alone, and takes sidebar widths from 300 to 800 px', async () => {
        const { handlers: registered, ipc } = fakeIpc();
        registerHandlers(ipc, handlers(), trusted);
        expect(await registered.get('hosts:add')?.({}, 'devbox-1')).toMatchObject({ installRoot: '~/.trc' });
        expect(await registered.get('sidebar:get-width')?.({})).toBe(400);
        await expect(registered.get('sidebar:set-width')?.({}, 300)).resolves.toBeUndefined();
        expect(await registered.get('sidebar:get-collapsed')?.({})).toBe(false);
        await expect(registered.get('sidebar:set-collapsed')?.({}, true)).resolves.toBeUndefined();
    });

    it('rejects requests from a page that is not the app', async () => {
        const { handlers: registered, ipc } = fakeIpc();
        registerHandlers(ipc, handlers(), () => false);
        await expect(async () => registered.get('display:get')?.({})).rejects.toThrow(/untrusted sender/);
    });
});

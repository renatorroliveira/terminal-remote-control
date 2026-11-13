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
        await expect(async () => registered.get('hosts:add')?.({}, 'devbox-1')).rejects.toThrow(/invalid arguments/);
    });

    it('rejects requests from a page that is not the app', async () => {
        const { handlers: registered, ipc } = fakeIpc();
        registerHandlers(ipc, handlers(), () => false);
        await expect(async () => registered.get('display:get')?.({})).rejects.toThrow(/untrusted sender/);
    });
});

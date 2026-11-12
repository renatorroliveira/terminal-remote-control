import { describe, expect, it } from 'vitest';
import { registerHandlers } from './ipc';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function fakeIpc() {
    const handlers = new Map<string, Handler>();
    return { handlers, ipc: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) } };
}

const trusted = () => true;

describe('registerHandlers (zod at the renderer boundary)', () => {
    it('answers valid requests', async () => {
        const { handlers, ipc } = fakeIpc();
        registerHandlers(ipc, { 'display:get': async () => ({ colorScheme: 'dark' }) as never }, trusted);
        expect(await handlers.get('display:get')?.({})).toEqual({ colorScheme: 'dark' });
    });

    it('rejects requests with arguments the contract does not allow', async () => {
        const { handlers, ipc } = fakeIpc();
        registerHandlers(ipc, { 'display:get': async () => ({}) as never }, trusted);
        await expect(async () => handlers.get('display:get')?.({}, 'unexpected')).rejects.toThrow(/invalid arguments/);
    });

    it('rejects requests from a page that is not the app', async () => {
        const { handlers, ipc } = fakeIpc();
        registerHandlers(ipc, { 'display:get': async () => ({}) as never }, () => false);
        await expect(async () => handlers.get('display:get')?.({})).rejects.toThrow(/untrusted sender/);
    });
});

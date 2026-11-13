import { z } from 'zod';
import type { InvokeChannel, InvokeContract } from '../shared/contract';
import { SIDEBAR_WIDTH } from '../shared/layout';

/** The part of `ipcMain` the registry uses. */
export interface IpcMainLike {
    handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void;
}

/** One handler per invoke channel. */
export type InvokeHandlers = {
    readonly [C in InvokeChannel]: (...args: InvokeContract[C]['args']) => Promise<InvokeContract[C]['result']>;
};

const HOST_ID = z.string().regex(/^host-[0-9a-f]{16}$/);

const ARGUMENTS: { readonly [C in InvokeChannel]: z.ZodType<InvokeContract[C]['args']> } = {
    'display:get': z.tuple([]),
    'accessibility:get': z.tuple([]),
    'hosts:list': z.tuple([]),
    'hosts:add': z.tuple([z.string().min(1).max(1024)]),
    'hosts:suggestions': z.tuple([]),
    'hosts:remove': z.tuple([HOST_ID]),
    'hosts:set-install-root': z.tuple([HOST_ID, z.string().min(1).max(4096)]),
    'sidebar:get-width': z.tuple([]),
    'sidebar:set-width': z.tuple([z.number().int().min(SIDEBAR_WIDTH.min).max(SIDEBAR_WIDTH.max)]),
    'sidebar:get-collapsed': z.tuple([]),
    'sidebar:set-collapsed': z.tuple([z.boolean()]),
};

/**
 * Registers the invoke handlers. Every request must come from the app's own page and carry arguments the
 * contract allows, validated with zod; anything else is rejected (TECH_STACK §4.2).
 */
export function registerHandlers(
    ipc: IpcMainLike,
    handlers: InvokeHandlers,
    isTrusted: (event: unknown) => boolean,
): void {
    for (const channel of Object.keys(handlers) as InvokeChannel[]) {
        register(ipc, channel, handlers[channel] as Handler<typeof channel>, isTrusted);
    }
}

type Handler<C extends InvokeChannel> = (...args: InvokeContract[C]['args']) => Promise<InvokeContract[C]['result']>;

function register<C extends InvokeChannel>(
    ipc: IpcMainLike,
    channel: C,
    handler: Handler<C>,
    isTrusted: (event: unknown) => boolean,
): void {
    const schema = ARGUMENTS[channel] as z.ZodType<InvokeContract[C]['args']>;
    ipc.handle(channel, async (event, ...args) => {
        if (!isTrusted(event)) {
            throw new Error(`${channel}: untrusted sender`);
        }
        const parsed = schema.safeParse(args);
        if (!parsed.success) {
            throw new Error(`${channel}: invalid arguments`);
        }
        return handler(...parsed.data);
    });
}

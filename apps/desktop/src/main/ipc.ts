import { z } from 'zod';
import type { InvokeChannel, InvokeContract } from '../shared/contract';

/** The part of `ipcMain` the registry uses. */
export interface IpcMainLike {
    handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void;
}

/** One handler per invoke channel. */
export type InvokeHandlers = {
    readonly [C in InvokeChannel]: (...args: InvokeContract[C]['args']) => Promise<InvokeContract[C]['result']>;
};

const ARGUMENTS: { readonly [C in InvokeChannel]: z.ZodType<InvokeContract[C]['args']> } = {
    'display:get': z.tuple([]),
    'accessibility:get': z.tuple([]),
    'hosts:list': z.tuple([]),
    'hosts:add': z.tuple([z.string().min(1).max(1024), z.string().min(1).max(4096)]),
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

import { ClientMessageSchema } from '@trc/protocol';
import { z } from 'zod';
import { type HostRequest, RESERVED_REQUEST_IDS } from '../../shared/connection';

const hostId = z.string().min(1).max(128);
const stream = z.number().int().min(1).max(0xffff_ffff);

const renderMessage = ClientMessageSchema.refine(
    (message) => message.type !== 'hello' && message.requestId < RESERVED_REQUEST_IDS,
    'the renderer never sends hello nor uses reserved request ids',
);

const hostRequestSchema: z.ZodType<HostRequest> = z.discriminatedUnion('type', [
    z.strictObject({
        type: z.literal('connect'),
        hostId,
        target: z.strictObject({
            destination: z.string().min(1).max(1024),
            port: z.number().int().min(1).max(65_535).exactOptional(),
            installRoot: z.string().min(1).max(4096),
        }),
    }),
    z.strictObject({ type: z.literal('send'), hostId, message: renderMessage }),
    z.strictObject({ type: z.literal('input'), hostId, stream, data: z.instanceof(Uint8Array) }),
    z.strictObject({ type: z.literal('credit'), hostId, stream, bytes: z.number().int().min(0).max(0xffff_ffff) }),
    z.strictObject({ type: z.literal('accept-host-key'), hostId, fingerprint: z.string().min(1).max(256) }),
    z.strictObject({ type: z.literal('reject-host-key'), hostId }),
    z.strictObject({ type: z.literal('disconnect'), hostId }),
]);

/** Validates a message from the renderer; anything malformed gives `undefined` (the renderer is a trust boundary). */
export function parseHostRequest(value: unknown): HostRequest | undefined {
    const parsed = hostRequestSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
}

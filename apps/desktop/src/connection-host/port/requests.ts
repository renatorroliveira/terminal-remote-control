import { ClientMessageSchema } from '@trc/protocol';
import { z } from 'zod';
import { type HostRequest, RESERVED_REQUEST_IDS } from '../../shared/connection';

const hostId = z.string().min(1).max(128);
const stream = z.number().int().min(1).max(0xffff_ffff);
const target = z.strictObject({
    destination: z.string().min(1).max(1024),
    port: z.number().int().min(1).max(65_535).exactOptional(),
    installRoot: z.string().min(1).max(4096),
});

const renderMessage = ClientMessageSchema.refine(
    (message) => message.type !== 'hello' && message.requestId < RESERVED_REQUEST_IDS,
    'the renderer never sends hello nor uses reserved request ids',
);

const hostRequestSchema: z.ZodType<HostRequest> = z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('connect'), hostId, target, restore: z.literal(true).exactOptional() }),
    z.strictObject({ type: z.literal('send'), hostId, message: renderMessage }),
    z.strictObject({ type: z.literal('input'), hostId, stream, data: z.instanceof(Uint8Array) }),
    z.strictObject({ type: z.literal('credit'), hostId, stream, bytes: z.number().int().min(0).max(0xffff_ffff) }),
    z.strictObject({ type: z.literal('accept-host-key'), hostId, fingerprint: z.string().min(1).max(256) }),
    z.strictObject({ type: z.literal('reject-host-key'), hostId }),
    z.strictObject({ type: z.literal('disconnect'), hostId }),
    z.strictObject({ type: z.literal('retry'), hostId }),
    z.strictObject({ type: z.literal('stop-retrying'), hostId }),
    z.strictObject({
        type: z.literal('remove-daemon'),
        hostId,
        target,
        graceMs: z.number().int().min(0).max(0xffff_ffff).exactOptional(),
    }),
]);

/** Validates a message from the renderer; anything malformed gives `undefined` (the renderer is a trust boundary). */
export function parseHostRequest(value: unknown): HostRequest | undefined {
    const parsed = hostRequestSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
}

/**
 * Where a malformed request breaks the schema, as the issue codes and the paths of the fields at fault, such as
 * `invalid_type at message.size.cols`; it holds no value, so it may be logged.
 */
export function requestProblem(value: unknown): string | undefined {
    const parsed = hostRequestSchema.safeParse(value);
    if (parsed.success) {
        return undefined;
    }
    const issues = parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.code} at ${issue.path.map(String).join('.')}`);
    return issues.join('; ').slice(0, 200);
}

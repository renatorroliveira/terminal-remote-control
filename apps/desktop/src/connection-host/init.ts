import { z } from 'zod';
import type { ConnectionHostInit } from '../shared/connection-port';

const initSchema: z.ZodType<ConnectionHostInit> = z.strictObject({
    type: z.literal('init'),
    userData: z.string().min(1),
    resources: z.string().min(1),
    appVersion: z.string().min(1),
    seam: z.strictObject({ sshConfig: z.string().min(1), knownHosts: z.string().min(1) }).exactOptional(),
});

/** Validates the main process's init message. */
export function parseInit(value: unknown): ConnectionHostInit | undefined {
    const parsed = initSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
}

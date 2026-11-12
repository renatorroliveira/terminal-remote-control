import { z } from 'zod';
import type { AttachMode } from './generated/AttachMode';
import type { ClientMessage } from './generated/ClientMessage';
import type { CreateSessionSpec } from './generated/CreateSessionSpec';
import type { ErrorCode } from './generated/ErrorCode';
import type { ExitStatus } from './generated/ExitStatus';
import type { Integration } from './generated/Integration';
import type { ProfileOrigin } from './generated/ProfileOrigin';
import type { ServerMessage } from './generated/ServerMessage';
import type { SessionChange } from './generated/SessionChange';
import type { SessionInfo } from './generated/SessionInfo';
import type { SessionState } from './generated/SessionState';
import type { ShellKind } from './generated/ShellKind';
import type { ShellProfile } from './generated/ShellProfile';
import type { TerminalSize } from './generated/TerminalSize';

const u16 = z.number().int().min(0).max(0xffff);
const u32 = z.number().int().min(0).max(0xffff_ffff);
const i32 = z.number().int().min(-0x8000_0000).max(0x7fff_ffff);
const timestamp = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const sessionId = z.string();

const shellKind: z.ZodType<ShellKind> = z
    .enum(['bash', 'zsh', 'fish', 'pwsh', 'powershell', 'cmd', 'wsl', 'sh', 'other', 'unspecified'])
    .catch('unspecified');
const profileOrigin: z.ZodType<ProfileOrigin> = z
    .enum(['login', 'detected', 'user', 'unspecified'])
    .catch('unspecified');
const integration: z.ZodType<Integration> = z.enum(['auto', 'off', 'unspecified']).catch('unspecified');
const sessionState: z.ZodType<SessionState> = z
    .enum(['starting', 'running', 'exited', 'stopped', 'failedToStart', 'unspecified'])
    .catch('unspecified');
const errorCode: z.ZodType<ErrorCode> = z
    .enum(['badRequest', 'unknownSession', 'unsupported', 'spawnFailed', 'internal', 'unspecified'])
    .catch('unspecified');

/** Validates an attach mode; unknown modes become `unspecified`. */
export const AttachModeSchema: z.ZodType<AttachMode> = z.enum(['full', 'events', 'unspecified']).catch('unspecified');

/** Validates a terminal size. */
export const TerminalSizeSchema: z.ZodType<TerminalSize> = z.object({ cols: u16, rows: u16 });

/** Validates a shell profile. */
export const ShellProfileSchema: z.ZodType<ShellProfile> = z.object({
    id: z.string(),
    name: z.string(),
    origin: profileOrigin,
    kind: shellKind,
    path: z.string(),
    args: z.array(z.string()),
    login: z.boolean(),
    env: z.record(z.string(), z.string().nullable()),
    cwd: z.string().exactOptional(),
    integration,
});

const exitStatus: z.ZodType<ExitStatus> = z.object({
    code: i32.exactOptional(),
    signal: z.string().exactOptional(),
});

/** Validates a session description from a daemon. */
export const SessionInfoSchema: z.ZodType<SessionInfo> = z.object({
    id: sessionId,
    customName: z.string().exactOptional(),
    title: z.string().exactOptional(),
    order: u32,
    state: sessionState,
    profile: ShellProfileSchema,
    cwd: z.string().exactOptional(),
    size: TerminalSizeSchema,
    pid: u32.exactOptional(),
    startedAt: timestamp.exactOptional(),
    lastOutputAt: timestamp.exactOptional(),
    exit: exitStatus.exactOptional(),
    failure: z.string().exactOptional(),
});

const sessionChange: z.ZodType<SessionChange> = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('created'), session: SessionInfoSchema }),
    z.object({ kind: z.literal('updated'), session: SessionInfoSchema }),
    z.object({ kind: z.literal('closed'), sessionId }),
    z.object({ kind: z.literal('reordered'), order: z.array(sessionId) }),
]);

/** Validates any message a daemon sends. Daemon output is untrusted (SEC-06). */
export const ServerMessageSchema: z.ZodType<ServerMessage> = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('welcome'),
        proto: u32,
        daemonVersion: z.string(),
        binarySha256: z.string(),
        caps: z.array(z.string()),
    }),
    z.object({ type: z.literal('incompatible'), minProto: u32, maxProto: u32 }),
    z.object({ type: z.literal('pong'), requestId: u32 }),
    z.object({ type: z.literal('sessions'), requestId: u32, sessions: z.array(SessionInfoSchema) }),
    z.object({ type: z.literal('profiles'), requestId: u32, profiles: z.array(ShellProfileSchema) }),
    z.object({ type: z.literal('created'), requestId: u32, session: SessionInfoSchema }),
    z.object({ type: z.literal('attached'), requestId: u32, session: sessionId, stream: u32, credit: u32 }),
    z.object({ type: z.literal('done'), requestId: u32 }),
    z.object({ type: z.literal('sessionEvent'), change: sessionChange }),
    z.object({ type: z.literal('error'), requestId: u32.exactOptional(), code: errorCode, message: z.string() }),
]);

const strictSize = z.strictObject({ cols: u16, rows: u16 });

const createSessionSpec: z.ZodType<CreateSessionSpec> = z.strictObject({
    profileId: z.string().exactOptional(),
    cwd: z.string().exactOptional(),
    name: z.string().exactOptional(),
    env: z.record(z.string(), z.string().nullable()),
    size: strictSize,
    scrollbackLines: u32.exactOptional(),
});

/**
 * Validates a message the app sends to a daemon, strictly: the renderer is a trust boundary, so unknown types,
 * fields and values are refused instead of being mapped to `unspecified`.
 */
export const ClientMessageSchema: z.ZodType<ClientMessage> = z.discriminatedUnion('type', [
    z.strictObject({
        type: z.literal('hello'),
        minProto: u32,
        maxProto: u32,
        appVersion: z.string(),
        caps: z.array(z.string()),
    }),
    z.strictObject({ type: z.literal('ping'), requestId: u32 }),
    z.strictObject({ type: z.literal('listSessions'), requestId: u32 }),
    z.strictObject({ type: z.literal('listProfiles'), requestId: u32 }),
    z.strictObject({ type: z.literal('create'), requestId: u32, spec: createSessionSpec }),
    z.strictObject({ type: z.literal('rename'), requestId: u32, session: sessionId, name: z.string().exactOptional() }),
    z.strictObject({ type: z.literal('reorder'), requestId: u32, session: sessionId, index: u32 }),
    z.strictObject({ type: z.literal('stop'), requestId: u32, session: sessionId, graceMs: u32.exactOptional() }),
    z.strictObject({ type: z.literal('restart'), requestId: u32, session: sessionId }),
    z.strictObject({ type: z.literal('close'), requestId: u32, session: sessionId }),
    z.strictObject({ type: z.literal('attach'), requestId: u32, session: sessionId, mode: z.enum(['full', 'events']) }),
    z.strictObject({ type: z.literal('detach'), requestId: u32, session: sessionId }),
    z.strictObject({ type: z.literal('resize'), requestId: u32, session: sessionId, size: strictSize }),
]);

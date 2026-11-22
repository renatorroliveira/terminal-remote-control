import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentState, AuthProbes, IdentityProbe } from '../ssh/classify';
import type { EffectiveConfig, SshVersion } from '../ssh/client-checks';
import { parseEffectiveConfig, parseSshVersion } from '../ssh/client-checks';

/** The result of running a local tool. */
interface Ran {
    readonly code: number | 'missing' | 'failed';
    readonly stdout: string;
    readonly stderr: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

const TOOL_TIMEOUT_MS = 10_000;
const VALID_UNTIL = /Valid: (?:from \S+ to|before) (\S+)/;

/** Expands a leading `~/`, or `~\` on Windows, to the home directory. */
export function expandHome(
    path: string,
    home: string = homedir(),
    platform: NodeJS.Platform = process.platform,
): string {
    const leading = path === '~' || path.startsWith('~/') || (platform === 'win32' && path.startsWith('~\\'));
    return leading ? join(home, path.slice(1)) : path;
}

/** The local OpenSSH version, `'missing'` when ssh is not installed, or `undefined` when it is not OpenSSH. */
export async function readSshVersion(ssh: string, env: Environment): Promise<SshVersion | 'missing' | undefined> {
    const ran = await runTool(ssh, ['-V'], env);
    return ran.code === 'missing' ? 'missing' : parseSshVersion(`${ran.stderr}${ran.stdout}`);
}

/** The effective settings from `ssh -G`, or `undefined` when ssh refuses the configuration. */
export async function readEffectiveConfig(
    ssh: string,
    args: readonly string[],
    env: Environment,
): Promise<EffectiveConfig | undefined> {
    const ran = await runTool(ssh, args, env);
    return ran.code === 0 ? parseEffectiveConfig(ran.stdout) : undefined;
}

/**
 * Local checks that explain a refused key, with `ssh-add` and `ssh-keygen` next to `ssh` and named as it is, with
 * `.exe` on Windows (US-1.3.1).
 */
export function createAuthProbes(toolDir: string, env: Environment, suffix = ''): AuthProbes {
    const sshAdd = join(toolDir, `ssh-add${suffix}`);
    const sshKeygen = join(toolDir, `ssh-keygen${suffix}`);
    return {
        agent: async () => agentState((await runTool(sshAdd, ['-l'], env)).code, suffix, env),
        agentKeys: async () => {
            const ran = await runTool(sshAdd, ['-L'], env);
            return ran.code === 0 ? ran.stdout.split(/\r?\n/).filter((line) => line !== '') : [];
        },
        identity: (path) => probeIdentity(sshKeygen, expandHome(path), env),
        certificateExpired: async (path) => {
            const ran = await runTool(sshKeygen, ['-L', '-f', expandHome(path)], env);
            const until = VALID_UNTIL.exec(ran.stdout)?.[1];
            return ran.code === 0 && until !== undefined && new Date(until).getTime() < Date.now();
        },
    };
}

/**
 * What `ssh-add -l`'s exit code says: on Windows, where `.exe` names the tools, no agent with no `SSH_AUTH_SOCK` means
 * the OpenSSH Authentication Agent service is not running, which Windows ships disabled (P-89).
 */
export function agentState(code: Ran['code'], suffix: string, env: Environment): AgentState {
    if (code === 0) {
        return 'loaded';
    }
    if (code === 1) {
        return 'empty';
    }
    return suffix === '.exe' && env['SSH_AUTH_SOCK'] === undefined ? 'windows-agent-off' : 'none';
}

async function probeIdentity(sshKeygen: string, path: string, env: Environment): Promise<IdentityProbe> {
    const exists = await stat(path).then(
        (found) => found.isFile(),
        () => false,
    );
    if (!exists) {
        return { exists: false, encrypted: false, publicKey: undefined };
    }
    const derived = await runTool(sshKeygen, ['-y', '-P', '', '-f', path], env);
    const sidecar = await readFile(`${path}.pub`, 'utf8').catch(() => undefined);
    const publicKey = firstTwoFields(sidecar ?? (derived.code === 0 ? derived.stdout : ''));
    return { exists: true, encrypted: derived.code !== 0, publicKey };
}

function firstTwoFields(text: string): string | undefined {
    const [type, key] = text.trim().split(/\s+/);
    return type !== undefined && key !== undefined && type !== '' ? `${type} ${key}` : undefined;
}

/** Runs a tool hidden, as on Windows a console program the app starts would otherwise open a console window (S9). */
function runTool(program: string, args: readonly string[], env: Environment): Promise<Ran> {
    return new Promise((resolve) => {
        const options = { env, encoding: 'utf8', timeout: TOOL_TIMEOUT_MS, windowsHide: true } as const;
        execFile(program, [...args], options, (error, stdout, stderr) => {
            resolve({ code: exitCode(error), stdout, stderr });
        });
    });
}

function exitCode(error: (Error & { code?: unknown }) | null): Ran['code'] {
    if (error === null) {
        return 0;
    }
    if (error.code === 'ENOENT') {
        return 'missing';
    }
    return typeof error.code === 'number' ? error.code : 'failed';
}

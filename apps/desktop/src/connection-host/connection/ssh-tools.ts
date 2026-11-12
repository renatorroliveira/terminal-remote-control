import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AuthProbes, IdentityProbe } from '../ssh/classify';
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

/** Expands a leading `~/` to the home directory. */
export function expandHome(path: string, home: string = homedir()): string {
    return path === '~' || path.startsWith('~/') ? join(home, path.slice(1)) : path;
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

/** Local checks that explain a refused key, with `ssh-add` and `ssh-keygen` next to `ssh` (US-1.3.1). */
export function createAuthProbes(toolDir: string, env: Environment): AuthProbes {
    const sshAdd = join(toolDir, 'ssh-add');
    const sshKeygen = join(toolDir, 'ssh-keygen');
    return {
        agent: async () => {
            const { code } = await runTool(sshAdd, ['-l'], env);
            if (code === 0) {
                return 'loaded';
            }
            return code === 1 ? 'empty' : 'none';
        },
        agentKeys: async () => {
            const ran = await runTool(sshAdd, ['-L'], env);
            return ran.code === 0 ? ran.stdout.split('\n').filter((line) => line !== '') : [];
        },
        identity: (path) => probeIdentity(sshKeygen, expandHome(path), env),
        certificateExpired: async (path) => {
            const ran = await runTool(sshKeygen, ['-L', '-f', expandHome(path)], env);
            const until = VALID_UNTIL.exec(ran.stdout)?.[1];
            return ran.code === 0 && until !== undefined && new Date(until).getTime() < Date.now();
        },
    };
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

function runTool(program: string, args: readonly string[], env: Environment): Promise<Ran> {
    return new Promise((resolve) => {
        execFile(program, [...args], { env, encoding: 'utf8', timeout: TOOL_TIMEOUT_MS }, (error, stdout, stderr) => {
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

/**
 * What the test-host tools share: where the generated files live, which ssh tools and docker context each OS uses,
 * and how the test SSH config is rendered (D-69). The Linux test hosts run on colima's `trc` profile on macOS and on
 * Docker Desktop's WSL 2 engine on Windows, from the same `compose.yaml`, with SSH on `127.0.0.1` only.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The folder of these tools. */
export const HERE = import.meta.dirname;
/** The repository root. */
export const REPOSITORY = resolve(HERE, '../..');
/** Where `up.ts` writes keys, the SSH config and known_hosts files (git-ignored). */
export const RUN = join(HERE, '.run');
/** The compose file of the Linux test hosts. */
export const COMPOSE = join(HERE, 'compose.yaml');

/** Every alias `up.ts` checks before it reports the hosts ready. */
export const SMOKE_ALIASES: readonly string[] = [
    'trc-ubuntu',
    'trc-ubuntu-nss',
    'trc-alpine',
    'trc-rocky',
    'trc-noexec',
    'trc-latency',
    'trc-systemd',
    'trc-systemd-linger',
    'trc-systemd-kill',
    'trc-scale-01',
    'trc-scale-25',
    'trc-jump',
    'trc-behind',
];

/** How many users the scale host has, `u01` to `u25`. */
const SCALE_USERS = 25;
const SCALE_PORT = 2227;

/** An OpenSSH tool: Windows' own by absolute path (D-66), else the system's in `/usr/bin`. */
export function sshTool(
    name: 'ssh' | 'ssh-keygen' | 'ssh-add',
    platform: NodeJS.Platform = process.platform,
    env: Readonly<Record<string, string | undefined>> = process.env,
): string {
    if (platform === 'win32') {
        return `${env['SystemRoot'] ?? 'C:\\Windows'}\\System32\\OpenSSH\\${name}.exe`;
    }
    return `/usr/bin/${name}`;
}

/** The environment for docker: colima's `trc` profile on macOS unless `DOCKER_CONTEXT` names another. */
export function dockerEnvironment(
    platform: NodeJS.Platform = process.platform,
    env: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string | undefined> {
    if (platform === 'darwin' && env['DOCKER_CONTEXT'] === undefined) {
        return { ...env, DOCKER_CONTEXT: 'colima-trc' };
    }
    return { ...env };
}

/** A path as the SSH config names it: forward slashes, which Windows OpenSSH reads too. */
export function configPath(path: string): string {
    return path.replaceAll('\\', '/');
}

/** The test SSH config: `ssh_config.in` with the run folder and the 25 scale hosts filled in. */
export function renderSshConfig(template: string, run: string): string {
    const scaleHosts = Array.from({ length: SCALE_USERS }, (_, index) => {
        const user = String(index + 1).padStart(2, '0');
        return `Host trc-scale-${user}\n    Port ${SCALE_PORT}\n    User u${user}\n`;
    }).join('\n');
    return template
        .split('\n')
        .map((line) => (line === '@SCALE_HOSTS@' ? scaleHosts : line.replaceAll('@RUN@', configPath(run))))
        .join('\n');
}

/**
 * Makes `folder` readable only by the user: mode 0700 on macOS and Linux; on Windows an ACL that grants only the
 * user's SID, inherited by everything inside, as Windows OpenSSH refuses a private key others can read.
 */
export function makePrivate(folder: string, platform: NodeJS.Platform = process.platform): void {
    if (platform !== 'win32') {
        chmodSync(folder, 0o700);
        return;
    }
    const icacls = `${process.env['SystemRoot'] ?? 'C:\\Windows'}\\System32\\icacls.exe`;
    execFileSync(icacls, [folder, '/inheritance:r', '/grant:r', `*${currentUserSid()}:(OI)(CI)F`, '/Q'], {
        stdio: 'ignore',
    });
}

/** Parses the SID from `whoami /user /fo csv /nh`, whose one line is `"<domain>\<user>","<SID>"`. */
export function parseWhoamiSid(text: string): string {
    const sid = /"(S-1-[\d-]+)"/.exec(text)?.[1];
    if (sid === undefined) {
        throw new Error('whoami printed no SID');
    }
    return sid;
}

function currentUserSid(): string {
    const whoami = `${process.env['SystemRoot'] ?? 'C:\\Windows'}\\System32\\whoami.exe`;
    return parseWhoamiSid(execFileSync(whoami, ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' }));
}

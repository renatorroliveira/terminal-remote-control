/**
 * Starts the Linux test hosts with fresh keys and writes `.run/ssh_config`, which every test passes to ssh with `-F`:
 * on colima's `trc` profile on macOS, on Docker Desktop on Windows (D-69). Run `node tools/test-hosts/up.ts`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
    COMPOSE,
    dockerEnvironment,
    HERE,
    makePrivate,
    RUN,
    renderSshConfig,
    SMOKE_ALIASES,
    sshTool,
} from './hosts.ts';

const SMOKE_ATTEMPTS = 20;
const SMOKE_PAUSE_MS = 500;

/** The ssh arguments that check one alias accepts a login, recording its key in `known_hosts.smoke`. */
export function smokeArguments(alias: string, run: string, ssh: string): readonly string[] {
    const config = join(run, 'ssh_config');
    const options = [
        '-F',
        config,
        '-o',
        'BatchMode=yes',
        '-o',
        'StrictHostKeyChecking=accept-new',
        '-o',
        `UserKnownHostsFile=${join(run, 'known_hosts.smoke')}`,
    ];
    if (alias !== 'trc-behind') {
        return [...options, alias, 'true'];
    }
    // The jump host's key is recorded too, through an ssh started by absolute path, not whichever one PATH finds.
    const jump = [`"${ssh}"`, ...options.map((option) => (option.includes(' ') ? `"${option}"` : option))];
    return [...options, '-o', `ProxyCommand=${[...jump, '-W', '%h:%p', 'trc-jump'].join(' ')}`, alias, 'true'];
}

function generateKeys(run: string): void {
    const keygen = sshTool('ssh-keygen');
    const newKey = (name: string, passphrase: string): void => {
        execFileSync(
            keygen,
            ['-q', '-t', 'ed25519', '-N', passphrase, '-C', `trc-test-${name}`, '-f', join(run, name)],
            { windowsHide: true },
        );
    };
    newKey('id_ed25519', '');
    newKey('id_ed25519_pass', 'trc-test-passphrase');
    for (const name of ['id_rejected', 'id_cert', 'id_expired', 'ca']) {
        newKey(name, '');
    }
    const sign = (identity: string, name: string, validity: string): void => {
        execFileSync(keygen, ['-q', '-s', join(run, 'ca'), '-I', identity, '-n', 'tester', '-V', validity, name], {
            windowsHide: true,
        });
    };
    sign('trc-valid', join(run, 'id_cert.pub'), '-1d:+30d');
    sign('trc-expired', join(run, 'id_expired.pub'), '-3d:-1d');
    const authorized = ['id_ed25519.pub', 'id_ed25519_pass.pub'].map((file) => readFileSync(join(run, file), 'utf8'));
    writeFileSync(join(run, 'keys-public', 'authorized_keys'), authorized.join(''));
    copyFileSync(join(run, 'ca.pub'), join(run, 'keys-public', 'ca.pub'));
    writeFileSync(join(run, 'known_hosts'), '');
}

function startContainers(run: string): void {
    const compose = spawnSync(
        'docker',
        ['compose', '-f', COMPOSE, 'up', '-d', '--build', '--wait', '--force-recreate'],
        { env: dockerEnvironment(), encoding: 'utf8', windowsHide: true },
    );
    writeFileSync(join(run, 'compose.log'), `${compose.stdout ?? ''}${compose.stderr ?? ''}`);
    if (compose.status !== 0) {
        throw new Error(`docker compose failed:\n${compose.stderr ?? compose.error?.message ?? ''}`);
    }
}

async function waitForLogins(run: string): Promise<void> {
    const ssh = sshTool('ssh');
    for (const alias of SMOKE_ALIASES) {
        let attempt = 0;
        while (spawnSync(ssh, smokeArguments(alias, run, ssh), { stdio: 'ignore', windowsHide: true }).status !== 0) {
            attempt += 1;
            if (attempt >= SMOKE_ATTEMPTS) {
                throw new Error(`test host ${alias} did not accept ssh`);
            }
            await sleep(SMOKE_PAUSE_MS);
        }
    }
}

/** Generates the keys and SSH config, starts the containers and waits until every host accepts a login. */
export async function up(run: string = RUN): Promise<void> {
    rmSync(run, { recursive: true, force: true });
    mkdirSync(join(run, 'keys-public'), { recursive: true });
    makePrivate(run);
    generateKeys(run);
    writeFileSync(join(run, 'ssh_config'), renderSshConfig(readFileSync(join(HERE, 'ssh_config.in'), 'utf8'), run));
    startContainers(run);
    await waitForLogins(run);
}

if (import.meta.main) {
    up().then(
        () => process.stdout.write(`test hosts ready: ${join(RUN, 'ssh_config')}\n`),
        (error: unknown) => {
            console.error(error instanceof Error ? error.message : error);
            process.exitCode = 1;
        },
    );
}

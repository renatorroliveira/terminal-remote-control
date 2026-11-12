import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConnectionHostInit } from '../shared/connection-port';
import { type DaemonManifest, parseDaemonManifest } from './bootstrap/manifest';
import type { ConnectionRuntime } from './connection/host-connection';
import { createAppLogger } from './logging/app-log';

/** The system OpenSSH client on macOS (TECH_STACK §4.2: spawned by absolute path). */
const SYSTEM_SSH = '/usr/bin/ssh';
const NO_DAEMONS: DaemonManifest = { version: '0', binaries: {} };

/** Builds what every connection shares from the main process's init message. */
export function createRuntime(init: ConnectionHostInit): ConnectionRuntime {
    const bin = join(init.resources, 'bin');
    const daemons = join(init.resources, 'daemon');
    const log = createAppLogger(join(init.userData, 'logs'));
    const manifestFile = join(daemons, 'manifest.json');
    if (!existsSync(manifestFile)) {
        log.error('daemon bundle missing; run pnpm build:daemon');
    }
    return {
        ssh: SYSTEM_SSH,
        helpers: { askpass: join(bin, 'askpass'), knownHosts: join(bin, 'known-hosts') },
        seam: init.seam,
        env: process.env,
        runDir: join(init.userData, 'run'),
        appVersion: init.appVersion,
        bootstrapTemplate: readFileSync(join(bin, 'bootstrap.sh'), 'utf8'),
        manifest: existsSync(manifestFile) ? parseDaemonManifest(readFileSync(manifestFile, 'utf8')) : NO_DAEMONS,
        readBinary: (platform) => readFile(join(daemons, platform, 'trcd')),
        log,
    };
}

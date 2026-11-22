import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConnectionHostInit } from '../shared/connection-port';
import { type DaemonManifest, parseDaemonManifest } from './bootstrap/manifest';
import type { ConnectionRuntime } from './connection/host-connection';
import { createAppLogger } from './logging/app-log';
import { platformSsh } from './ssh/platform-ssh';

const NO_DAEMONS: DaemonManifest = { version: '0', binaries: {} };

/** Builds what every connection shares from the main process's init message. */
export function createRuntime(init: ConnectionHostInit): ConnectionRuntime {
    const bin = join(init.resources, 'bin');
    const { ssh, helpers, systemConfig, logLevel } = platformSsh(process.platform, init.resources);
    const daemons = join(init.resources, 'daemon');
    const log = createAppLogger(join(init.userData, 'logs'));
    const manifestFile = join(daemons, 'manifest.json');
    if (!existsSync(manifestFile)) {
        log.error('daemon bundle missing; run pnpm build:daemon');
    }
    return {
        ssh,
        helpers,
        systemSshConfig: systemConfig,
        sshLogLevel: logLevel,
        seam: init.seam,
        env: process.env,
        runDir: join(init.userData, 'run'),
        appVersion: init.appVersion,
        bootstrapTemplate: readFileSync(join(bin, 'bootstrap.sh'), 'utf8'),
        manifest: existsSync(manifestFile) ? parseDaemonManifest(readFileSync(manifestFile, 'utf8')) : NO_DAEMONS,
        readBinary: (platform) => readFile(join(daemons, platform, 'trcd')),
        log,
        localHome: init.localHome,
    };
}

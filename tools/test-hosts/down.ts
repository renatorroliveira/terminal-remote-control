/** Stops and removes the Linux test hosts and their generated keys. Run `node tools/test-hosts/down.ts`. */
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { COMPOSE, dockerEnvironment, RUN } from './hosts.ts';

spawnSync('docker', ['compose', '-f', COMPOSE, 'down', '--remove-orphans', '--volumes'], {
    env: dockerEnvironment(),
    stdio: 'ignore',
});
rmSync(RUN, { recursive: true, force: true });

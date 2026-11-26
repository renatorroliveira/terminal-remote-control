/**
 * Installs the lefthook hooks into this repository's own .git/hooks directory. A global core.hooksPath (for example
 * a company-wide hook manager) is left untouched; such managers usually run the repository's hooks after their own.
 * Runs from `pnpm install` on every OS, so it needs no POSIX shell (Windows, E6).
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

function installHooks(): void {
    const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
        cwd: ROOT,
        encoding: 'utf8',
        windowsHide: true,
    }).trim();
    const lefthook = createRequire(join(ROOT, 'package.json')).resolve('lefthook/bin/index.js');
    // Points lefthook at this repository's hooks for this one command, past any global core.hooksPath.
    const hooksPath = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath' };
    execFileSync(process.execPath, [lefthook, 'install', '--force'], {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, ...hooksPath, GIT_CONFIG_VALUE_0: join(resolve(ROOT, commonDir), 'hooks') },
        windowsHide: true,
    });
}

if (import.meta.main) {
    installHooks();
}

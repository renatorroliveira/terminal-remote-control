import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, skipFirstQuitNotice } from './support/launch';
import { rowTexts } from './support/test-host';

const repository = resolve(import.meta.dirname, '../../../..');
const universal = join(repository, 'apps/desktop/resources/daemon/darwin-universal/trcd');
const uid = process.getuid?.() ?? 0;

/** A scratch TRC home, where This computer's daemon installs, and the scratch home its LaunchAgent plist goes to. */
function scratchLocal(): { readonly trcHome: string; readonly localHome: string } {
    const base = realpathSync(mkdtempSync('/tmp/trce-'));
    const localHome = join(base, 'local-home');
    mkdirSync(localHome, { mode: 0o700 });
    return { trcHome: join(base, 'home'), localHome };
}

/** Boots out the scratch daemon's temporary LaunchAgent, ends its processes and deletes the scratch folders (P-58). */
function removeLocalDaemon(trcHome: string): void {
    if (!existsSync(trcHome)) {
        return;
    }
    const root = realpathSync(trcHome);
    const label = `dev.trc.trcd-${createHash('sha256').update(root).digest('hex').slice(0, 8)}`;
    spawnSync('launchctl', ['bootout', `gui/${uid}/${label}`]);
    spawnSync('pkill', ['-KILL', '-f', `${root}/versions/`]);
    rmSync(dirname(root), { recursive: true, force: true });
}

test.describe('This computer (US-4.1, US-4.2)', () => {
    test.skip(process.platform !== 'darwin' || !existsSync(universal), 'needs macOS and pnpm build:daemon');
    const scratch = { trcHome: '' };
    test.afterEach(() => {
        removeLocalDaemon(scratch.trcHome);
    });

    test('installs its daemon at launch, lists it first, and runs a local shell without SSH', async () => {
        const local = scratchLocal();
        scratch.trcHome = local.trcHome;
        skipFirstQuitNotice(local.trcHome);
        const app = await launchApp([], { TRC_HOME: local.trcHome, TRC_TEST_LOCAL_HOME: local.localHome });
        const window = await app.firstWindow();
        const hosts = window.getByRole('list', { name: 'Known hosts' });
        await expect(hosts.getByRole('listitem').first()).toContainText('This computer', { timeout: 20_000 });
        await window.getByRole('button', { name: 'Disconnect This computer' }).waitFor({ timeout: 60_000 });
        await window.getByRole('button', { name: 'New session on This computer' }).click();
        const terminal = window.getByRole('textbox', { name: /, This computer$/ });
        await terminal.waitFor({ timeout: 30_000 });
        await terminal.focus();
        await window.keyboard.type('echo "local-$((6*7))"');
        await window.keyboard.press('Enter');
        await expect.poll(() => rowTexts(terminal), { timeout: 15_000 }).toContain('local-42');
        await app.close();
    });
});

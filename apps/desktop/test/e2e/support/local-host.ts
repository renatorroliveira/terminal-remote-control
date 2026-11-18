import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { type ElectronApplication, expect, type Page } from '@playwright/test';
import { launchApp, skipFirstQuitNotice } from './launch';
import { rowTexts } from './test-host';

const repository = resolve(import.meta.dirname, '../../../../..');
/** The universal macOS daemon This computer installs; the local tests skip without it. */
export const LOCAL_DAEMON = join(repository, 'apps/desktop/resources/daemon/darwin-universal/trcd');
const uid = process.getuid?.() ?? 0;

/** This computer's scratch folders: the TRC home its daemon installs in, and the home its LaunchAgent plist goes to. */
export interface ScratchLocal {
    readonly trcHome: string;
    readonly localHome: string;
}

/** A scratch TRC home, where This computer's daemon installs, and the scratch home its LaunchAgent plist goes to. */
export function scratchLocal(): ScratchLocal {
    const base = realpathSync(mkdtempSync('/tmp/trce-'));
    const localHome = join(base, 'local-home');
    mkdirSync(localHome, { mode: 0o700 });
    return { trcHome: join(base, 'home'), localHome };
}

/**
 * Boots out the scratch daemon's temporary LaunchAgent, ends its processes and deletes the scratch folders (P-58);
 * refuses any TRC home that {@link scratchLocal} did not make, so it never touches a real one.
 */
export function removeLocalDaemon(trcHome: string): void {
    if (!existsSync(trcHome)) {
        return;
    }
    const root = realpathSync(trcHome);
    if (!/^\/private\/tmp\/trce-[^/]+\/home$/.test(root)) {
        throw new Error(`not a scratch TRC home: ${root}`);
    }
    const label = `dev.trc.trcd-${createHash('sha256').update(root).digest('hex').slice(0, 8)}`;
    spawnSync('launchctl', ['bootout', `gui/${uid}/${label}`]);
    spawnSync('pkill', ['-KILL', '-f', `${root}/versions/`]);
    rmSync(dirname(root), { recursive: true, force: true });
}

/** Launches the test build with This computer installing in `local`'s scratch TRC home. */
export async function launchLocal(
    local: ScratchLocal,
): Promise<{ readonly app: ElectronApplication; readonly window: Page }> {
    skipFirstQuitNotice(local.trcHome);
    const app = await launchApp([], { TRC_HOME: local.trcHome, TRC_TEST_LOCAL_HOME: local.localHome });
    const window = await app.firstWindow();
    await window.getByRole('button', { name: 'Disconnect This computer' }).waitFor({ timeout: 60_000 });
    return { app, window };
}

/** Whether the process `pid` runs on this Mac. */
export function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/** Opens a local session, has its shell print its PID, and returns it. */
export async function localShell(window: Page): Promise<number> {
    await window.getByRole('button', { name: 'New session on This computer' }).click();
    const terminal = window.getByRole('textbox', { name: /, This computer$/ });
    await terminal.waitFor({ timeout: 30_000 });
    await terminal.focus();
    await window.keyboard.type('echo "pid=$$"');
    await window.keyboard.press('Enter');
    let pid = 0;
    await expect
        .poll(async () => {
            pid = Number(/^pid=(\d+)$/m.exec((await rowTexts(terminal)).join('\n'))?.[1] ?? 0);
            return pid;
        })
        .not.toBe(0);
    return pid;
}

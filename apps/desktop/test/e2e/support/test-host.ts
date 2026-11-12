import { copyFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type ElectronApplication, _electron as electron, type Locator, type Page } from '@playwright/test';

const repository = resolve(import.meta.dirname, '../../../../..');
const run = join(repository, 'tools/test-hosts/.run');
const manifest = join(repository, 'apps/desktop/resources/daemon/manifest.json');
const appDirectory = resolve(import.meta.dirname, '../../..');

/** Why the test hosts cannot be used, or `undefined` when they can. */
export function testHostsMissing(): string | undefined {
    if (!existsSync(join(run, 'ssh_config')) || !existsSync(join(run, 'known_hosts.smoke'))) {
        return 'start the test hosts with tools/test-hosts/up.sh';
    }
    return existsSync(manifest) ? undefined : 'build the daemons with pnpm build:daemon';
}

/** A test build of the app, launched with the P-14 seam pointing at the test hosts. */
export interface TestHostApp {
    readonly app: ElectronApplication;
    readonly window: Page;
}

/** Launches the test build with the test hosts' ssh config and known hosts. */
export async function launchWithTestHosts(): Promise<TestHostApp> {
    const scratch = mkdtempSync(join(tmpdir(), 'trc-e2e-'));
    const knownHosts = join(scratch, 'known_hosts');
    copyFileSync(join(run, 'known_hosts.smoke'), knownHosts);
    const app = await electron.launch({
        args: [appDirectory, `--user-data-dir=${join(scratch, 'user-data')}`],
        env: { ...process.env, TRC_TEST_SSH_CONFIG: join(run, 'ssh_config'), TRC_TEST_KNOWN_HOSTS: knownHosts },
    });
    return { app, window: await app.firstWindow() };
}

/** Connects the test host panel to `destination` and returns the terminal's text surface once it opens. */
export async function openTerminal(window: Page, destination: string): Promise<Locator> {
    await window.getByLabel('Destination').fill(destination);
    await window.getByRole('button', { name: 'Connect' }).click();
    const terminal = window.getByRole('textbox', { name: `shell, ${destination}` });
    await terminal.waitFor({ timeout: 60_000 });
    return terminal;
}

/** The text of every row the terminal's text surface exposes. */
export function rowTexts(terminal: Locator): Promise<string[]> {
    return terminal.locator('[data-row]').allTextContents();
}

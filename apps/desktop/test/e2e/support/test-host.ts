import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { launchApp } from './launch';

const repository = resolve(import.meta.dirname, '../../../../..');
const run = join(repository, 'tools/test-hosts/.run');
const manifest = join(repository, 'apps/desktop/resources/daemon/manifest.json');

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
    /** The scratch TRC home of this launch. */
    readonly home: string;
    /** The file the test build writes opened links to instead of opening them. */
    readonly openedLinks: string;
}

/**
 * Launches the test build with the test hosts' ssh config and known hosts and any extra command-line `args`; hosts
 * it adds install under `installRoot`.
 */
export async function launchWithTestHosts(installRoot?: string, args: readonly string[] = []): Promise<TestHostApp> {
    const scratch = mkdtempSync(join(tmpdir(), 'trc-e2e-'));
    const knownHosts = join(scratch, 'known_hosts');
    const home = join(scratch, 'home');
    const openedLinks = join(scratch, 'opened-links.log');
    copyFileSync(join(run, 'known_hosts.smoke'), knownHosts);
    const app = await launchApp([`--user-data-dir=${join(scratch, 'user-data')}`, ...args], {
        TRC_TEST_SSH_CONFIG: join(run, 'ssh_config'),
        TRC_TEST_KNOWN_HOSTS: knownHosts,
        TRC_TEST_OPENED_LINKS: openedLinks,
        TRC_HOME: home,
        ...(installRoot === undefined ? {} : { TRC_TEST_INSTALL_ROOT: installRoot }),
    });
    return { app, window: await app.firstWindow(), home, openedLinks };
}

/** A fresh install location on the test hosts, removed by {@link removeInstall}. */
export function scratchInstallRoot(): string {
    return `~/.trc-e2e-${randomBytes(4).toString('hex')}`;
}

/** Stops the daemon a test installed under `root` on `alias`, and removes the install. */
export function removeInstall(alias: string, root: string): void {
    const path = root.replace('~', '$HOME');
    const script = `kill $(cat "${path}/run/core.lock" 2>/dev/null) 2>/dev/null; pkill -f "${path}/" ; rm -rf "${path}"`;
    try {
        execFileSync(
            'ssh',
            [
                '-F',
                join(run, 'ssh_config'),
                '-o',
                'BatchMode=yes',
                '-o',
                'StrictHostKeyChecking=yes',
                '-o',
                `UserKnownHostsFile=${join(run, 'known_hosts.smoke')}`,
                alias,
                script,
            ],
            { stdio: 'ignore' },
        );
    } catch {
        return;
    }
}

/**
 * Adds `destination` as a known host, choosing its SSH config suggestion by name so a pointer resting over the list
 * cannot pick another, connects it from its badge, creates a session, and returns the session's text
 * surface once it opens.
 */
export async function openTerminal(window: Page, destination: string): Promise<Locator> {
    await window.getByRole('combobox', { name: 'New host' }).fill(destination);
    await window.getByRole('option', { name: destination, exact: true }).click();
    await window.getByRole('button', { name: 'Add host' }).click();
    await window.getByRole('button', { name: `Connect ${destination}` }).click();
    await window.getByRole('button', { name: `Disconnect ${destination}` }).waitFor({ timeout: 60_000 });
    await window.getByRole('button', { name: `New session on ${destination}` }).click();
    const terminal = window.getByRole('textbox', { name: new RegExp(`, ${destination}$`) });
    await terminal.waitFor({ timeout: 30_000 });
    return terminal;
}

/** The text of every row the terminal's text surface exposes. */
export function rowTexts(terminal: Locator): Promise<string[]> {
    return terminal.locator('[data-row]').allTextContents();
}

interface SpeechWindow {
    __trcSpoken?: string[];
}

/** Records everything the page speaks, through `ariaNotify` or a live region, for {@link spokenTexts}. */
export function recordSpeech(window: Page): Promise<void> {
    return window.evaluate(() => {
        const spoken: string[] = [];
        (globalThis as SpeechWindow).__trcSpoken = spoken;
        const page = document as Document & { ariaNotify?: (text: string, options?: unknown) => void };
        const notify = page.ariaNotify?.bind(page);
        if (notify !== undefined) {
            page.ariaNotify = (text, options) => {
                spoken.push(text);
                notify(text, options);
            };
        }
        new MutationObserver((records) => {
            for (const record of records) {
                const region = record.target.parentElement?.closest('[aria-live]') ?? record.target;
                if (region instanceof HTMLElement && region.hasAttribute('aria-live')) {
                    spoken.push(region.textContent ?? '');
                }
            }
        }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
}

/** What the page spoke since {@link recordSpeech}. */
export function spokenTexts(window: Page): Promise<string[]> {
    return window.evaluate(() => [...((globalThis as SpeechWindow).__trcSpoken ?? [])]);
}

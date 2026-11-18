import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { bootOutAgent } from '../../mac-hosts';
import { launchApp, skipFirstQuitNotice } from './launch';

const repository = resolve(import.meta.dirname, '../../../../..');
const run = join(repository, 'tools/test-hosts/.run');
const manifest = join(repository, 'apps/desktop/resources/daemon/manifest.json');

/**
 * The host the single-host specs run on: `trc-ubuntu` unless `TRC_E2E_HOST` names another, such as `trc-mac-gui` or
 * `trc-mac-nogui` while the macOS test host runs (US-4.5.1).
 */
export const E2E_HOST = process.env['TRC_E2E_HOST'] ?? 'trc-ubuntu';

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
    /** The scratch folder of this launch, which a later launch may reuse. */
    readonly scratch: string;
    /** The scratch TRC home of this launch. */
    readonly home: string;
    /** The file the test build writes opened links to instead of opening them. */
    readonly openedLinks: string;
}

/** How {@link launchWithTestHosts} launches the app. */
export interface LaunchOptions {
    /** Extra command-line arguments. */
    readonly args?: readonly string[];
    /** The scratch folder of an earlier launch, to launch the app again with its TRC home, as after a quit. */
    readonly scratch?: string;
    /** Keeps the first-quit notice (US-2.1.5); other launches start as if it was shown, so quitting never waits. */
    readonly firstQuit?: boolean;
    /**
     * Opens the app as a user would, opaque and able to take focus, for the AX tests, which read what macOS reports
     * for the key window (D-27); other launches open unseen.
     */
    readonly foreground?: boolean;
}

/**
 * Launches the test build with the test hosts' ssh config and known hosts; hosts it adds install under
 * `installRoot`.
 */
export async function launchWithTestHosts(installRoot?: string, options: LaunchOptions = {}): Promise<TestHostApp> {
    const scratch = options.scratch ?? mkdtempSync(join(tmpdir(), 'trc-e2e-'));
    const knownHosts = join(scratch, 'known_hosts');
    const home = join(scratch, 'home');
    const openedLinks = join(scratch, 'opened-links.log');
    if (!existsSync(knownHosts)) {
        copyFileSync(join(run, 'known_hosts.smoke'), knownHosts);
    }
    if (options.firstQuit !== true) {
        skipFirstQuitNotice(home);
    }
    const app = await launchApp([`--user-data-dir=${join(scratch, 'user-data')}`, ...(options.args ?? [])], {
        TRC_TEST_SSH_CONFIG: join(run, 'ssh_config'),
        TRC_TEST_KNOWN_HOSTS: knownHosts,
        TRC_TEST_OPENED_LINKS: openedLinks,
        TRC_HOME: home,
        ...(installRoot === undefined ? {} : { TRC_TEST_INSTALL_ROOT: installRoot }),
        ...(options.foreground === true ? { TRC_TEST_BACKGROUND: '0' } : {}),
    });
    return { app, window: await app.firstWindow(), scratch, home, openedLinks };
}

/** A fresh install location on the test hosts, removed by {@link removeInstall}. */
export function scratchInstallRoot(): string {
    return `~/.trc-e2e-${randomBytes(4).toString('hex')}`;
}

/** Stops the daemon a test installed under `root` on `alias`, and removes the install. */
export function removeInstall(alias: string, root: string): void {
    const path = root.replace('~', '$HOME');
    const script = `${bootOutAgent(root)}; kill $(head -n 1 "${path}/run/core.lock" 2>/dev/null) 2>/dev/null; pkill -f "${path}/" ; rm -rf "${path}"`;
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

/** Runs a shell command on a test host over SSH; returns its output, or `''`. */
function overSsh(alias: string, script: string): string {
    const known = `UserKnownHostsFile=${join(run, 'known_hosts.smoke')}`;
    try {
        return execFileSync('ssh', ['-F', join(run, 'ssh_config'), '-o', 'BatchMode=yes', '-o', known, alias, script], {
            encoding: 'utf8',
            timeout: 30_000,
        });
    } catch {
        return '';
    }
}

/** The docker container of a test host, such as `trc-test-hosts-ubuntu-1` for `trc-ubuntu`. */
function container(alias: string): readonly string[] {
    return [
        '--context',
        process.env['DOCKER_CONTEXT'] ?? 'colima-trc',
        `trc-test-hosts-${alias.replace(/^trc-/, '')}-1`,
    ];
}

/**
 * Runs a shell command on a test host as its test user, from outside its sshd for a container, or over SSH for the
 * macOS test host; returns its output, or `''`.
 */
export function onTestHost(alias: string, script: string): string {
    if (alias.startsWith('trc-mac-')) {
        return overSsh(alias, script);
    }
    const [flag, context, name] = container(alias);
    try {
        return execFileSync(
            'docker',
            [flag ?? '', context ?? '', 'exec', '-u', 'tester', name ?? '', 'sh', '-c', script],
            {
                encoding: 'utf8',
                timeout: 30_000,
            },
        );
    } catch {
        return '';
    }
}

/**
 * Restarts a test host's container, which ends every process in it as a reboot does but keeps its files and its
 * boot ID (P-50); the macOS test host's VM reboots instead, and this returns once its sshd answers again.
 */
export function restartTestHost(alias: string): void {
    if (alias.startsWith('trc-mac-')) {
        overSsh('trc-mac-gui', '(sleep 1; sudo shutdown -r now) >/dev/null 2>&1 &');
        execFileSync('sh', ['-c', 'sleep 15'], { stdio: 'ignore' });
        const started = Date.now();
        while (overSsh(alias, 'echo up').trim() !== 'up') {
            if (Date.now() - started > 180_000) {
                throw new Error(`${alias} did not come back`);
            }
            execFileSync('sh', ['-c', 'sleep 2'], { stdio: 'ignore' });
        }
        return;
    }
    const [flag, context, name] = container(alias);
    execFileSync('docker', [flag ?? '', context ?? '', 'restart', '--time', '1', name ?? ''], {
        stdio: 'ignore',
        timeout: 60_000,
    });
}

/**
 * Adds `destination` as a known host, choosing its SSH config suggestion by name so a pointer resting over the list
 * cannot pick another, connects it from its badge, creates a session, past the warning a host that ends processes at
 * logout gives first (US-2.4.4), and returns the session's text surface once it opens.
 */
export async function openTerminal(window: Page, destination: string): Promise<Locator> {
    await window.getByRole('combobox', { name: 'New host' }).fill(destination);
    await window.getByRole('option', { name: destination, exact: true }).click();
    await window.getByRole('button', { name: 'Add host' }).click();
    await window.getByRole('button', { name: `Connect ${destination}` }).click();
    await window.getByRole('button', { name: `Disconnect ${destination}` }).waitFor({ timeout: 60_000 });
    await window.getByRole('button', { name: `New session on ${destination}` }).click();
    const terminal = window.getByRole('textbox', { name: new RegExp(`, ${destination}$`) });
    const warning = window.getByRole('alertdialog', { name: `Programs on ${destination} end when you disconnect` });
    await terminal.or(warning).first().waitFor({ timeout: 30_000 });
    if (await warning.isVisible()) {
        await warning.getByRole('button', { name: 'Create Session' }).click();
    }
    await terminal.waitFor({ timeout: 30_000 });
    return terminal;
}

/** The text of every row the terminal's text surface exposes. */
export function rowTexts(terminal: Locator): Promise<readonly string[]> {
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
export function spokenTexts(window: Page): Promise<readonly string[]> {
    return window.evaluate(() => [...((globalThis as SpeechWindow).__trcSpoken ?? [])]);
}

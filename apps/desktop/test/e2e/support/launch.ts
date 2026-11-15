import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type ElectronApplication, _electron as electron } from '@playwright/test';

/** The app's directory, which Electron loads. */
export const APP_DIRECTORY = resolve(import.meta.dirname, '../../..');

/** The environment every test launch gets: the test build opens unseen and never takes focus (D-27). */
export function testEnvironment(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
    return { ...(process.env as Record<string, string>), TRC_TEST_BACKGROUND: '1', ...extra };
}

/**
 * Starts a scratch TRC home as if the first-quit notice had been shown (US-2.1.5), so a test's quit never waits for
 * it; a home that already has `config.json` keeps it.
 */
export function skipFirstQuitNotice(home: string): void {
    const config = join(home, 'config.json');
    if (!existsSync(config)) {
        mkdirSync(home, { recursive: true, mode: 0o700 });
        writeFileSync(config, `${JSON.stringify({ quitNoticeShown: true })}\n`, { mode: 0o600 });
    }
}

/** A fresh, empty app profile, so a test launch never shares the developer's profile or their running app. */
export function scratchProfile(): string {
    return `--user-data-dir=${mkdtempSync(join(tmpdir(), 'trc-e2e-profile-'))}`;
}

/**
 * Launches the test build without taking the developer's focus, in a scratch profile unless `args` names one and a
 * scratch TRC home unless `env` names one, so a test never reads or writes the developer's own. A scratch home it
 * makes starts as if the first-quit notice was shown.
 */
export function launchApp(
    args: readonly string[] = [],
    env: Readonly<Record<string, string>> = {},
): Promise<ElectronApplication> {
    const profile = args.some((arg) => arg.startsWith('--user-data-dir=')) ? [] : [scratchProfile()];
    const home = { TRC_HOME: mkdtempSync(join(tmpdir(), 'trc-e2e-home-')), ...env };
    if (env['TRC_HOME'] === undefined) {
        skipFirstQuitNotice(home.TRC_HOME);
    }
    return electron.launch({ args: [APP_DIRECTORY, ...profile, ...args], env: testEnvironment(home) });
}

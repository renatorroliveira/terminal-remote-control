import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type ElectronApplication, _electron as electron } from '@playwright/test';

/** The app's directory, which Electron loads. */
export const APP_DIRECTORY = resolve(import.meta.dirname, '../../..');

/** The environment every test launch gets: the test build opens behind the focused app. */
export function testEnvironment(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
    return { ...(process.env as Record<string, string>), TRC_TEST_BACKGROUND: '1', ...extra };
}

/** A fresh, empty app profile, so a test launch never shares the developer's profile or their running app. */
export function scratchProfile(): string {
    return `--user-data-dir=${mkdtempSync(join(tmpdir(), 'trc-e2e-profile-'))}`;
}

/**
 * Launches the test build without taking the developer's focus, in a scratch profile unless `args` names one and a
 * scratch TRC home unless `env` names one, so a test never reads or writes the developer's own.
 */
export function launchApp(
    args: readonly string[] = [],
    env: Readonly<Record<string, string>> = {},
): Promise<ElectronApplication> {
    const profile = args.some((arg) => arg.startsWith('--user-data-dir=')) ? [] : [scratchProfile()];
    const home = { TRC_HOME: mkdtempSync(join(tmpdir(), 'trc-e2e-home-')), ...env };
    return electron.launch({ args: [APP_DIRECTORY, ...profile, ...args], env: testEnvironment(home) });
}

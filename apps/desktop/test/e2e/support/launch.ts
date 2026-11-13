import { resolve } from 'node:path';
import { type ElectronApplication, _electron as electron } from '@playwright/test';

/** The app's directory, which Electron loads. */
export const APP_DIRECTORY = resolve(import.meta.dirname, '../../..');

/** The environment every test launch gets: the test build opens behind the focused app. */
export function testEnvironment(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
    return { ...(process.env as Record<string, string>), TRC_TEST_BACKGROUND: '1', ...extra };
}

/** Launches the test build without taking the developer's focus. */
export function launchApp(
    args: readonly string[] = [],
    env: Readonly<Record<string, string>> = {},
): Promise<ElectronApplication> {
    return electron.launch({ args: [APP_DIRECTORY, ...args], env: testEnvironment(env) });
}

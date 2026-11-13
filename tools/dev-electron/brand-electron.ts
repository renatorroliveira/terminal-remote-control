import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, utimesSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

/** What the development Electron.app shows now. */
export interface BundleBranding {
    readonly name: string;
    readonly displayName: string;
    readonly iconMatches: boolean;
}

/** One change the development bundle needs. */
export type BrandingStep = 'rename' | 'icon' | 'sign';

const ROOT = resolve(import.meta.dirname, '../..');
const PRODUCT_NAME = 'Terminal Remote Control';
const ICON = join(ROOT, 'apps/desktop/resources/icons/icon.icns');
const LSREGISTER =
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

/**
 * The changes that make the development Electron.app carry the product name and icon in the macOS menu bar, the
 * Dock and the About panel: rename it, swap its icon, and re-sign it ad hoc, because both edits break Electron's
 * signature, then touch it so Launch Services drops the cached name and icon. A bundle that is already branded needs
 * nothing.
 */
export function brandingSteps(current: BundleBranding, productName: string): readonly BrandingStep[] {
    const rename = current.name !== productName || current.displayName !== productName;
    const steps: BrandingStep[] = [
        ...(rename ? (['rename'] as const) : []),
        ...(current.iconMatches ? [] : (['icon'] as const)),
    ];
    return steps.length === 0 ? [] : [...steps, 'sign'];
}

/**
 * Brands the development Electron.app that `electron .`, the e2e tests and the test build run (D-35). It runs after
 * `pnpm install`, only on macOS, and leaves release builds alone: electron-builder names and signs those itself.
 */
export function brandDevelopmentElectron(): void {
    if (process.platform !== 'darwin') {
        return;
    }
    const bundle = developmentBundle();
    const plist = join(bundle, 'Contents/Info.plist');
    const icon = join(bundle, 'Contents/Resources', plistValue(plist, 'CFBundleIconFile'));
    const current = {
        name: plistValue(plist, 'CFBundleName'),
        displayName: plistValue(plist, 'CFBundleDisplayName'),
        iconMatches: readFileSync(icon).equals(readFileSync(ICON)),
    };
    for (const step of brandingSteps(current, PRODUCT_NAME)) {
        applyStep(step, { bundle, plist, icon });
    }
}

interface BundlePaths {
    readonly bundle: string;
    readonly plist: string;
    readonly icon: string;
}

function applyStep(step: BrandingStep, paths: BundlePaths): void {
    switch (step) {
        case 'rename':
            run('plutil', ['-replace', 'CFBundleName', '-string', PRODUCT_NAME, paths.plist]);
            run('plutil', ['-replace', 'CFBundleDisplayName', '-string', PRODUCT_NAME, paths.plist]);
            return;
        case 'icon':
            copyFileSync(ICON, paths.icon);
            return;
        case 'sign':
            run('codesign', ['--force', '--deep', '--sign', '-', paths.bundle]);
            refreshLaunchServices(paths.bundle);
            return;
    }
}

function refreshLaunchServices(bundle: string): void {
    const now = new Date();
    for (const path of [bundle, join(bundle, 'Contents')]) {
        utimesSync(path, now, now);
    }
    run(LSREGISTER, ['-f', bundle]);
}

function developmentBundle(): string {
    const require = createRequire(join(ROOT, 'apps/desktop/package.json'));
    const executable: unknown = require('electron');
    if (typeof executable !== 'string') {
        throw new Error('the electron package did not name its executable');
    }
    return resolve(executable, '../../..');
}

function plistValue(plist: string, key: string): string {
    return execFileSync('plutil', ['-extract', key, 'raw', plist], { encoding: 'utf8' }).trim();
}

function run(command: string, args: readonly string[]): void {
    execFileSync(command, args, { stdio: 'ignore' });
}

if (import.meta.main) {
    brandDevelopmentElectron();
}

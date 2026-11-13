import type { AboutPanelOptionsOptions } from 'electron';
import { APP_IDENTITY } from '../shared/app-identity';

/** What the build is: its semver and the commit it was built from. */
export interface BuildInfo {
    readonly version: string;
    readonly commit: string;
}

/**
 * The About panel: the product name and its version, with the commit as the build number in parentheses, the
 * copyright and the repository. macOS shows the app icon above them.
 */
export function aboutPanelOptions(build: BuildInfo): AboutPanelOptionsOptions {
    return {
        applicationName: APP_IDENTITY.productName,
        applicationVersion: build.version,
        version: build.commit,
        copyright: APP_IDENTITY.copyright,
        credits: APP_IDENTITY.repositoryUrl,
    };
}

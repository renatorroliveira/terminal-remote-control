import type { HelloLine } from './lines';
import type { DaemonBinary, DaemonManifest, DaemonPlatform } from './manifest';

/** What the app does after the host's hello (US-1.4.1, US-1.4.2, US-1.4.4, US-1.4.6). */
export type InstallPlan =
    | { readonly kind: 'run'; readonly sha256: string }
    | {
          readonly kind: 'upload';
          readonly platform: DaemonPlatform;
          readonly binary: DaemonBinary;
          readonly version: string;
      }
    | {
          readonly kind: 'unsupported';
          readonly missing: 'os' | 'arch' | 'checksum-tool';
          readonly os: string;
          readonly arch: string;
      };

const PLATFORM_BY_ARCH: ReadonlyMap<string, DaemonPlatform> = new Map([
    ['x86_64', 'linux-x64'],
    ['arm64', 'linux-arm64'],
]);

/**
 * Decides how to reach a daemon on the host: run the bundled one when it is installed, otherwise upload it. A newer
 * daemon installed beside it keeps running, as the bundled bridge never replaces a newer core; whether the two can
 * talk is the handshake's to say (D-46, NFR-12).
 */
export function planInstall(hello: HelloLine, manifest: DaemonManifest): InstallPlan {
    const unsupported = (missing: 'os' | 'arch' | 'checksum-tool'): InstallPlan => ({
        kind: 'unsupported',
        missing,
        os: hello.os,
        arch: hello.arch,
    });
    if (hello.os !== 'Linux') {
        return unsupported('os');
    }
    const platform = PLATFORM_BY_ARCH.get(hello.arch);
    const binary = platform === undefined ? undefined : manifest.binaries[platform];
    if (platform === undefined || binary === undefined) {
        return unsupported('arch');
    }
    if (hello.installed.some((daemon) => daemon.sha256 === binary.sha256)) {
        return { kind: 'run', sha256: binary.sha256 };
    }
    if (hello.checksum === 'none') {
        return unsupported('checksum-tool');
    }
    return { kind: 'upload', platform, binary, version: manifest.version };
}

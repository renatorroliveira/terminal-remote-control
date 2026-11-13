import { describe, expect, it } from 'vitest';
import { planInstall } from './install-plan';
import type { HelloLine } from './lines';
import type { DaemonManifest } from './manifest';

const bundledSha = 'b'.repeat(64);
const manifest: DaemonManifest = {
    version: '0.2.0',
    binaries: { 'linux-x64': { sha256: 'a'.repeat(64), size: 1 }, 'linux-arm64': { sha256: bundledSha, size: 2 } },
};

function hello(overrides: Partial<HelloLine>): HelloLine {
    return { kind: 'hello', os: 'Linux', arch: 'arm64', checksum: 'sha256sum', installed: [], ...overrides };
}

describe('planInstall', () => {
    it('uploads the matching binary when none is installed', () => {
        expect(planInstall(hello({}), manifest)).toEqual({
            kind: 'upload',
            platform: 'linux-arm64',
            binary: { sha256: bundledSha, size: 2 },
            version: '0.2.0',
        });
    });

    it('runs the bundled daemon when it is already installed', () => {
        const installed = [{ sha256: bundledSha, version: '0.2.0' }];
        expect(planInstall(hello({ installed }), manifest)).toEqual({ kind: 'run', sha256: bundledSha });
    });

    it('upgrades an older daemon', () => {
        const installed = [{ sha256: 'c'.repeat(64), version: '0.1.9' }];
        expect(planInstall(hello({ installed }), manifest).kind).toBe('upload');
    });

    it('never downgrades: a newer daemon asks for an app update', () => {
        const installed = [
            { sha256: 'c'.repeat(64), version: '0.1.0' },
            { sha256: 'e'.repeat(64), version: '0.10.0' },
        ];
        expect(planInstall(hello({ installed }), manifest)).toEqual({ kind: 'update-app', installedVersion: '0.10.0' });
    });

    it('lets development and release daemons sit side by side: a -dev version never counts as newer', () => {
        const installed = [{ sha256: 'e'.repeat(64), version: '9.0.0-dev' }];
        expect(planInstall(hello({ installed }), manifest).kind).toBe('upload');
        const development = { ...manifest, version: '0.2.0-dev' };
        expect(
            planInstall(hello({ installed: [{ sha256: 'c'.repeat(64), version: '0.3.0' }] }), development).kind,
        ).toBe('upload');
    });

    it('reports an unsupported system with what is missing', () => {
        expect(planInstall(hello({ os: 'Darwin' }), manifest)).toEqual({
            kind: 'unsupported',
            missing: 'os',
            os: 'Darwin',
            arch: 'arm64',
        });
        expect(planInstall(hello({ arch: 'unsupported' }), manifest)).toMatchObject({
            kind: 'unsupported',
            missing: 'arch',
        });
        const armOnly: DaemonManifest = {
            version: '0.2.0',
            binaries: { 'linux-arm64': { sha256: bundledSha, size: 2 } },
        };
        expect(planInstall(hello({ arch: 'x86_64' }), armOnly)).toMatchObject({ kind: 'unsupported', missing: 'arch' });
        expect(planInstall(hello({ checksum: 'none' }), manifest)).toMatchObject({
            kind: 'unsupported',
            missing: 'checksum-tool',
        });
    });
});

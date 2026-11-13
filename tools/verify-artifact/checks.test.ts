import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    descendants,
    expectedFuses,
    fuseProblems,
    listenerProblems,
    lsofVisibilityProblems,
    manifestProblems,
    seamProblems,
    signatureProblems,
} from './checks.ts';

const ROOT = join(import.meta.dirname, '../..');

describe('expectedFuses', () => {
    it('reads the fuses electron-builder.yml sets (TECH_STACK §4.5)', () => {
        const yaml = readFileSync(join(ROOT, 'apps/desktop/electron-builder.yml'), 'utf8');
        expect(expectedFuses(yaml)).toEqual({
            runAsNode: false,
            enableNodeOptionsEnvironmentVariable: false,
            enableNodeCliInspectArguments: false,
            grantFileProtocolExtraPrivileges: false,
            enableEmbeddedAsarIntegrityValidation: true,
            onlyLoadAppFromAsar: true,
        });
    });

    it('refuses a config that sets no fuses, so the check can never pass on nothing', () => {
        expect(() => expectedFuses('appId: dev.trc.desktop\n')).toThrow(/sets no electronFuses/);
        expect(() => expectedFuses('electronFuses:\nmac:\n')).toThrow(/sets no electronFuses/);
        expect(() =>
            expectedFuses('electronFuses:\n    runAsNode: false\n    # note\n    onlyLoadAppFromAsar: maybe\n'),
        ).toThrow(/line 3 under electronFuses/);
    });
});

describe('fuseProblems', () => {
    const expected = { runAsNode: false, onlyLoadAppFromAsar: true };

    it('passes a binary whose fuses match', () => {
        expect(
            fuseProblems({ runAsNode: false, onlyLoadAppFromAsar: true, enableCookieEncryption: false }, expected),
        ).toEqual([]);
    });

    it('names each fuse that differs or is missing', () => {
        expect(fuseProblems({ runAsNode: true }, expected)).toEqual([
            'fuse runAsNode is on, expected off',
            'fuse onlyLoadAppFromAsar is missing, expected on',
        ]);
    });
});

describe('seamProblems', () => {
    it('finds any TRC_TEST_ variable name left in the bundle (P-14)', () => {
        expect(seamProblems('const a = env["TRC_TEST_SSH_CONFIG"]; const b = "TRC_TEST_SSH_CONFIG";')).toEqual([
            'test seam variable TRC_TEST_SSH_CONFIG is in the app bundle',
        ]);
        expect(seamProblems('const home = env["TRC_HOME"];')).toEqual([]);
    });
});

describe('manifestProblems', () => {
    const manifest = JSON.stringify({
        version: '0.2.0',
        binaries: { 'linux-x64': { sha256: 'aa', size: 2 }, 'linux-arm64': { sha256: 'bb', size: 3 } },
    });

    it('passes daemons that match the manifest and the app version (SEC-04.2)', () => {
        const files = { 'linux-x64': { sha256: 'aa', size: 2 }, 'linux-arm64': { sha256: 'bb', size: 3 } };
        expect(manifestProblems(manifest, files, '0.2.0')).toEqual([]);
    });

    it('names a changed or missing daemon, and a version that is not the app version', () => {
        const files = { 'linux-x64': { sha256: 'ff', size: 2 }, 'linux-arm64': undefined };
        expect(manifestProblems(manifest, files, '0.3.0')).toEqual([
            'daemon manifest version 0.2.0 is not the app version 0.3.0',
            'daemon linux-x64 does not match the manifest',
            'daemon linux-arm64 is missing',
        ]);
    });

    it('requires both Linux daemons', () => {
        expect(manifestProblems(JSON.stringify({ version: '1.0.0', binaries: {} }), {}, '1.0.0')).toEqual([
            'daemon linux-x64 is missing from the manifest',
            'daemon linux-arm64 is missing from the manifest',
        ]);
    });
});

describe('listenerProblems', () => {
    it('reports every socket an lsof -F pcn run lists, and nothing when it found none (SEC-01)', () => {
        const stdout = 'p22778\ncTerminal\nf32\nn127.0.0.1:9333\nf33\nn*:5353\np22779\ncHelper\nn[::1]:4000\n';
        expect(listenerProblems({ status: 0, stdout, stderr: '' })).toEqual([
            'socket open: Terminal 22778 127.0.0.1:9333',
            'socket open: Terminal 22778 *:5353',
            'socket open: Helper 22779 [::1]:4000',
        ]);
        expect(listenerProblems({ status: 1, stdout: '', stderr: '' })).toEqual([]);
    });

    it('fails an lsof run that errored, so a broken lsof never reads as no sockets', () => {
        expect(listenerProblems({ status: 1, stdout: '', stderr: 'lsof: illegal option' })).toEqual([
            'lsof failed (exit 1): lsof: illegal option',
        ]);
        expect(listenerProblems({ status: null, stdout: '', stderr: '' })).toEqual(['lsof failed (exit null): ']);
    });
});

describe('lsofVisibilityProblems', () => {
    it('passes when lsof lists the process’s working directory, and fails when it cannot see the process', () => {
        expect(lsofVisibilityProblems({ status: 0, stdout: 'p10\nfcwd\nn/\n', stderr: '' }, 10)).toEqual([]);
        expect(lsofVisibilityProblems({ status: 1, stdout: '', stderr: '' }, 10)).toEqual([
            'lsof cannot see the app’s process 10, so the socket check would prove nothing',
        ]);
    });
});

describe('descendants', () => {
    it('lists a process and everything it started, from ps output', () => {
        const ps = '  1     0\n 10     1\n 11    10\n 12    11\n 20     1\n';
        expect(descendants(ps, 10)).toEqual([10, 11, 12]);
    });
});

describe('signatureProblems', () => {
    it('expects an ad-hoc signature (P-11)', () => {
        expect(signatureProblems('Executable=/x\nSignature=adhoc\nTeamIdentifier=not set\n')).toEqual([]);
        expect(signatureProblems('Executable=/x\nAuthority=Developer ID\n')).toEqual(['the app is not ad-hoc signed']);
    });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    descendants,
    expectedFuses,
    fuseProblems,
    listenerProblems,
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
    it('reports every socket lsof lists, and nothing for an empty list (SEC-01)', () => {
        const lsof =
            'COMMAND   PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nTerminal 22778 me 32u IPv4 0x6f 0t0 TCP 127.0.0.1:9333 (LISTEN)\n';
        expect(listenerProblems(lsof)).toEqual(['socket open: Terminal 22778 TCP 127.0.0.1:9333 (LISTEN)']);
        expect(listenerProblems('')).toEqual([]);
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

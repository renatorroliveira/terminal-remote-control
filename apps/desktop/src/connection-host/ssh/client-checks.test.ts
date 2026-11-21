import { describe, expect, it } from 'vitest';
import {
    DEFAULT_KNOWN_HOSTS_FILES,
    parseEffectiveConfig,
    parseSshVersion,
    replacementKnownHostsFiles,
    supportsKnownHostsCommand,
} from './client-checks';

describe('parseSshVersion', () => {
    it.each([
        ['OpenSSH_10.5p1, LibreSSL 3.3.6', { major: 10, minor: 5 }],
        ['OpenSSH_8.5p1 Ubuntu-1, OpenSSL 1.1.1', { major: 8, minor: 5 }],
        ['OpenSSH_for_Windows_9.5p1, LibreSSL 3.8.2', { major: 9, minor: 5 }],
    ])('reads %s', (text, expected) => {
        expect(parseSshVersion(text)).toEqual(expected);
    });

    it('returns undefined for something else', () => {
        expect(parseSshVersion('Dropbear v2022.83')).toBeUndefined();
    });

    it('requires OpenSSH 8.5 for KnownHostsCommand', () => {
        expect(supportsKnownHostsCommand({ major: 8, minor: 5 })).toBe(true);
        expect(supportsKnownHostsCommand({ major: 8, minor: 4 })).toBe(false);
        expect(supportsKnownHostsCommand({ major: 9, minor: 0 })).toBe(true);
        expect(supportsKnownHostsCommand({ major: 7, minor: 9 })).toBe(false);
    });
});

describe('parseEffectiveConfig', () => {
    it('collects repeated keys and splits known_hosts lists', () => {
        const config = parseEffectiveConfig(
            [
                'user tester',
                'hostname 127.0.0.1',
                'port 2221',
                'identityfile ~/.ssh/id_rsa',
                'identityfile /run/id_ed25519',
                'certificatefile /run/id_cert-cert.pub',
                'userknownhostsfile ~/.ssh/known_hosts ~/.ssh/known_hosts2',
                'hashknownhosts yes',
                'proxyjump none',
                '',
            ].join('\n'),
        );
        expect(config).toEqual({
            user: 'tester',
            hostname: '127.0.0.1',
            port: 2221,
            identityFiles: ['~/.ssh/id_rsa', '/run/id_ed25519'],
            certificateFiles: ['/run/id_cert-cert.pub'],
            knownHostsFiles: ['~/.ssh/known_hosts', '~/.ssh/known_hosts2'],
            hashKnownHosts: true,
            proxyJump: undefined,
        });
    });

    it('reports a jump host', () => {
        expect(parseEffectiveConfig('hostname behind\nport 22\nproxyjump trc-jump\n').proxyJump).toBe('trc-jump');
    });
});

describe('replacementKnownHostsFiles (US-1.2.1)', () => {
    it.each([[['/dev/null']], [['none']], [['/dev/null', 'none']]])(
        "reads OpenSSH's defaults when %j keeps no key, as DevSpaces' configuration sets",
        (files) => {
            expect(replacementKnownHostsFiles(files)).toEqual(DEFAULT_KNOWN_HOSTS_FILES);
        },
    );

    it.each([[['~/.ssh/known_hosts']], [['/dev/null', '~/.ssh/devspaces_known_hosts']], [[]]])(
        "keeps ssh's own files when %j keeps keys",
        (files) => {
            expect(replacementKnownHostsFiles(files)).toBeUndefined();
        },
    );
});

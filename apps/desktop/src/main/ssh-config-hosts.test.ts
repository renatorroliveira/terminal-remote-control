import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSshConfig, sshConfigFilesFor, sshConfigHosts } from './ssh-config-hosts';

describe('parseSshConfig: Host names and Include lines', () => {
    it('reads Host names, skipping patterns and negations, and Include paths, in any keyword case or with =', () => {
        const parsed = parseSshConfig(
            [
                '# a comment',
                'Host devbox-1 build.example.com',
                '    User me',
                'host=staging *.internal !bastion',
                'Match host foo',
                'Host db? web-1 # trailing comment',
                'Include config.d/* ~/other.conf',
            ].join('\n'),
        );
        expect(parsed).toEqual([
            { host: 'devbox-1' },
            { host: 'build.example.com' },
            { host: 'staging' },
            { host: 'web-1' },
            { include: 'config.d/*' },
            { include: '~/other.conf' },
        ]);
    });
});

describe('sshConfigHosts: every Host the user can type, from ~/.ssh/config and its Includes (US-1.1.1)', () => {
    it('follows Include files and globs relative to ~/.ssh, in order, without repeats or loops', async () => {
        const home = mkdtempSync(join(tmpdir(), 'trc-ssh-'));
        const ssh = join(home, '.ssh');
        mkdirSync(join(ssh, 'config.d'), { recursive: true });
        writeFileSync(
            join(ssh, 'config'),
            'Host first\nInclude config.d/*.conf\nInclude ~/.ssh/config\nHost last first\n',
        );
        writeFileSync(join(ssh, 'config.d', 'b.conf'), 'Host bravo\n');
        writeFileSync(join(ssh, 'config.d', 'a.conf'), 'Host alpha\nInclude missing.conf\n');
        writeFileSync(join(ssh, 'config.d', 'skip.txt'), 'Host never\n');
        expect(await sshConfigHosts([join(ssh, 'config')], home)).toEqual(['first', 'alpha', 'bravo', 'last']);
    });

    it('reads nothing from a missing file', async () => {
        const home = mkdtempSync(join(tmpdir(), 'trc-ssh-'));
        expect(await sshConfigHosts([join(home, '.ssh', 'config')], home)).toEqual([]);
    });
});

describe('sshConfigFilesFor: which configuration files to read', () => {
    it('reads ~/.ssh/config, after the P-14 seam file in a test build only', () => {
        const env = { TRC_TEST_SSH_CONFIG: '/tmp/seam/ssh_config' };
        expect(sshConfigFilesFor({ seamEnabled: true, env, home: '/home/me' })).toEqual([
            '/tmp/seam/ssh_config',
            '/home/me/.ssh/config',
        ]);
        expect(sshConfigFilesFor({ seamEnabled: false, env, home: '/home/me' })).toEqual(['/home/me/.ssh/config']);
    });
});

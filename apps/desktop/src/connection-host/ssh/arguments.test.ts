import { describe, expect, it } from 'vitest';
import { effectiveConfigArguments, sshArguments, sshEnvironment, wrapperConfig } from './arguments';

const helpers = {
    askpass: '/Apps/Term Remote Control.app/bin/askpass',
    knownHosts: '/Apps/Term Remote Control.app/bin/known-hosts',
};

const EXPECTED_ARGUMENTS = [
    '-F',
    '/run/w.conf',
    '-T',
    '-e',
    'none',
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'KnownHostsCommand="/Apps/Term Remote Control.app/bin/known-hosts" %I %H %t %K %f',
    '-o',
    'PreferredAuthentications=publickey',
    '-o',
    'PasswordAuthentication=no',
    '-o',
    'KbdInteractiveAuthentication=no',
    '-o',
    'ForwardAgent=no',
    '-o',
    'ForwardX11=no',
    '-o',
    'ClearAllForwardings=yes',
    '-o',
    'PermitLocalCommand=no',
    '-o',
    'ServerAliveInterval=10',
    '-o',
    'ServerAliveCountMax=2',
    '-o',
    'ConnectTimeout=15',
    '-o',
    'LogLevel=ERROR',
    '--',
    'devbox-1',
    'exec /bin/sh -s',
];

describe('sshArguments', () => {
    it('passes the wrapper config and every security option on the command line (US-1.1.4, SEC-03)', () => {
        const args = sshArguments({
            wrapper: '/run/w.conf',
            helpers,
            target: { destination: 'devbox-1' },
            command: 'exec /bin/sh -s',
        });
        expect(args).toEqual(EXPECTED_ARGUMENTS);
    });

    it('adds a typed port and the test known_hosts file', () => {
        const args = sshArguments({
            wrapper: '/w',
            helpers,
            target: { destination: 'me@10.0.0.5', port: 2222 },
            command: 'true',
            seam: { sshConfig: '/t/ssh_config', knownHosts: '/t/known_hosts' },
        });
        expect(args).toContain('UserKnownHostsFile=/t/known_hosts');
        expect(args.join(' ')).toContain('-p 2222 -- me@10.0.0.5 true');
    });

    it.each(['-oProxyCommand=evil', 'host name', 'host\nname', '', 'a\u0000b'])(
        'refuses the destination %j',
        (destination) => {
            expect(() => sshArguments({ wrapper: '/w', helpers, target: { destination }, command: 'true' })).toThrow(
                /destination/,
            );
        },
    );

    it('refuses a port outside 1-65535', () => {
        expect(() =>
            sshArguments({ wrapper: '/w', helpers, target: { destination: 'h', port: 0 }, command: 'true' }),
        ).toThrow(/port/);
    });
});

describe('wrapperConfig (D-21)', () => {
    it('sets the security options for every host, then includes the user and system configs', () => {
        const text = wrapperConfig({ helpers });
        expect(text).toBe(
            [
                'Host *',
                '    BatchMode yes',
                '    StrictHostKeyChecking yes',
                '    KnownHostsCommand "/Apps/Term Remote Control.app/bin/known-hosts" %I %H %t %K %f',
                '    PreferredAuthentications publickey',
                '    PasswordAuthentication no',
                '    KbdInteractiveAuthentication no',
                '    ForwardAgent no',
                '    ForwardX11 no',
                '    ClearAllForwardings yes',
                '    PermitLocalCommand no',
                '    ServerAliveInterval 10',
                '    ServerAliveCountMax 2',
                '    ConnectTimeout 15',
                '    LogLevel ERROR',
                '',
                'Include ~/.ssh/config',
                'Include /etc/ssh/ssh_config',
                '',
            ].join('\n'),
        );
    });

    it('includes the test config and known_hosts file instead in test builds (P-14)', () => {
        const text = wrapperConfig({ helpers, seam: { sshConfig: '/t/my config', knownHosts: '/t/known_hosts' } });
        expect(text).toContain('    UserKnownHostsFile "/t/known_hosts"\n');
        expect(text).toContain('Include "/t/my config"\nInclude /etc/ssh/ssh_config\n');
        expect(text).not.toContain('~/.ssh/config');
    });

    it('refuses paths it cannot quote', () => {
        expect(() => wrapperConfig({ helpers: { ...helpers, knownHosts: '/a"b' } })).toThrow(/quote/);
    });
});

describe('sshEnvironment', () => {
    it('forces the askpass helper and passes the helper nonce, keeping the agent socket', () => {
        const env = sshEnvironment({ SSH_AUTH_SOCK: '/agent', HOME: '/Users/x', DISPLAY: ':0' }, helpers, 'abcd');
        expect(env).toEqual({
            SSH_AUTH_SOCK: '/agent',
            HOME: '/Users/x',
            DISPLAY: ':0',
            SSH_ASKPASS: helpers.askpass,
            SSH_ASKPASS_REQUIRE: 'force',
            TRC_SSH_NONCE: 'abcd',
        });
    });
});

describe('effectiveConfigArguments', () => {
    it('asks ssh -G for the effective settings through the same wrapper', () => {
        expect(effectiveConfigArguments('/w', { destination: 'devbox-1' })).toEqual([
            '-F',
            '/w',
            '-G',
            '--',
            'devbox-1',
        ]);
        expect(effectiveConfigArguments('/w', { destination: 'me@h', port: 2222 })).toEqual([
            '-F',
            '/w',
            '-G',
            '-p',
            '2222',
            '--',
            'me@h',
        ]);
    });

    it('refuses a destination that looks like an option', () => {
        expect(() => effectiveConfigArguments('/w', { destination: '-oProxyCommand=x' })).toThrow(/destination/);
    });
});

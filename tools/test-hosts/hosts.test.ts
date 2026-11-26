import { posix, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cacheFolder, listedDigest } from './fetch-old-daemon.ts';
import { configPath, dockerEnvironment, parseWhoamiSid, renderSshConfig, sshTool } from './hosts.ts';
import { containerPath, muslTarget, runScript, shellsFor, testExecutables } from './rust-tests.ts';
import { smokeArguments } from './up.ts';

describe('the test-host tools (D-69)', () => {
    it('takes ssh tools from System32 on Windows and /usr/bin elsewhere', () => {
        expect(sshTool('ssh-keygen', 'win32', { SystemRoot: 'C:\\WINDOWS' })).toBe(
            'C:\\WINDOWS\\System32\\OpenSSH\\ssh-keygen.exe',
        );
        expect(sshTool('ssh', 'darwin', {})).toBe('/usr/bin/ssh');
    });

    it("uses colima's trc profile on macOS unless DOCKER_CONTEXT names another, and the current context elsewhere", () => {
        expect(dockerEnvironment('darwin', {})['DOCKER_CONTEXT']).toBe('colima-trc');
        expect(dockerEnvironment('darwin', { DOCKER_CONTEXT: 'other' })['DOCKER_CONTEXT']).toBe('other');
        expect(dockerEnvironment('win32', {})['DOCKER_CONTEXT']).toBeUndefined();
    });

    it('renders the SSH config with forward-slash run paths and the 25 scale hosts', () => {
        const config = renderSshConfig('Host a\n    IdentityFile @RUN@/id\n@SCALE_HOSTS@\n', 'D:\\repo\\.run');
        expect(config).toContain('IdentityFile D:/repo/.run/id');
        expect(config).toContain('Host trc-scale-01\n    Port 2227\n    User u01\n');
        expect(config).toContain('Host trc-scale-25\n    Port 2227\n    User u25\n');
        expect(configPath('C:\\a\\b')).toBe('C:/a/b');
    });

    it('reads the SID from whoami', () => {
        expect(parseWhoamiSid('"host\\user","S-1-5-21-1-2-3-1001"\r\n')).toBe('S-1-5-21-1-2-3-1001');
        expect(() => parseWhoamiSid('nothing')).toThrow('no SID');
    });

    it('checks the host behind the jump host through an ssh started by absolute path', () => {
        const args = smokeArguments('trc-behind', 'C:\\run', 'C:\\Windows\\System32\\OpenSSH\\ssh.exe');
        const proxy = args.find((arg) => arg.startsWith('ProxyCommand='));
        expect(proxy).toMatch(/^ProxyCommand="C:\\Windows\\System32\\OpenSSH\\ssh\.exe" -F /);
        expect(proxy).toContain('-W %h:%p trc-jump');
        expect(args.slice(-2)).toEqual(['trc-behind', 'true']);
        expect(smokeArguments('trc-ubuntu', '/run', '/usr/bin/ssh').some((arg) => arg.startsWith('ProxyCommand'))).toBe(
            false,
        );
    });

    it('builds the daemon tests for the musl target of this architecture', () => {
        expect(muslTarget('arm64')).toBe('aarch64-unknown-linux-musl');
        expect(muslTarget('x64')).toBe('x86_64-unknown-linux-musl');
        expect(() => muslTarget('ia32')).toThrow('unsupported');
    });

    it('lists the test executables from cargo and maps them into the container', () => {
        const json = [
            '{"reason":"compiler-artifact","executable":"/r/target/x/release/deps/trcd-1","profile":{"test":true}}',
            '{"reason":"compiler-artifact","executable":null,"profile":{"test":false}}',
            '{"reason":"build-finished"}',
        ].join('\n');
        expect(testExecutables(json)).toEqual(['/r/target/x/release/deps/trcd-1']);
        expect(containerPath('D:\\r\\target\\x\\release\\deps\\trcd-1', 'D:\\r\\target', win32)).toBe(
            '/target/x/release/deps/trcd-1',
        );
        expect(containerPath('/r/target/x/release/deps/trcd-1', '/r/target', posix)).toBe(
            '/target/x/release/deps/trcd-1',
        );
        expect(runScript(['/target/a'])).toContain("for binary in '/target/a'; do");
        expect(shellsFor('alpine:3.23')).toBe('RUN apk add --no-cache bash zsh fish');
    });

    it('caches old daemons where the soak tests read them, and reads the listed digest', () => {
        expect(cacheFolder('0.2.0', { TRC_CACHE_DIR: '/c' })).toMatch(/[/\\]c[/\\]daemon[/\\]0\.2\.0$/);
        expect(listedDigest('abc  TRC-0.2.0-mac-arm64.zip\ndef  other.zip\n', 'TRC-0.2.0-mac-arm64.zip')).toBe('abc');
    });
});

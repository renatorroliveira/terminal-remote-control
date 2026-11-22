import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { windowsTrcd } from '../../shared/windows-helper';
import { platformSsh } from './platform-ssh';

describe('platformSsh (TECH_STACK §7, D-66)', () => {
    it("runs macOS's ssh and the sh helpers in resources/bin", () => {
        expect(platformSsh('darwin', '/R')).toEqual({
            ssh: '/usr/bin/ssh',
            helpers: { askpass: join('/R', 'bin', 'askpass'), knownHosts: join('/R', 'bin', 'known-hosts') },
            systemConfig: '/etc/ssh/ssh_config',
            logLevel: 'ERROR',
        });
    });

    it("runs Windows' own ssh by absolute path and trcd.exe's helpers for this architecture", () => {
        const env = { SystemRoot: 'C:\\WINDOWS', ProgramData: 'C:\\ProgramData' };
        const trcd = 'C:\\Program Files\\TRC\\resources\\daemon\\windows-x64\\trcd.exe';
        expect(platformSsh('win32', 'C:\\Program Files\\TRC\\resources', 'x64', env)).toEqual({
            ssh: 'C:\\WINDOWS\\System32\\OpenSSH\\ssh.exe',
            helpers: { askpass: `"${trcd}" askpass`, knownHosts: trcd, knownHostsArgs: ['known-hosts'] },
            systemConfig: 'C:/ProgramData/ssh/ssh_config',
            logLevel: 'INFO',
        });
    });

    it('picks the arm64 trcd.exe on arm64 Windows', () => {
        expect(windowsTrcd('R', 'arm64')).toBe('R\\daemon\\windows-arm64\\trcd.exe');
    });
});

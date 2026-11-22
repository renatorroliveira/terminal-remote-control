import { join } from 'node:path';
import { windowsTrcd } from '../../shared/windows-helper';
import { quoteForSsh, type SshHelpers, type SshLogLevel } from './arguments';

/** The OpenSSH client the app runs on one OS, and the helpers ssh runs for it. */
export interface PlatformSsh {
    /** ssh by absolute path, never one found on PATH (TECH_STACK §7, D-66). */
    readonly ssh: string;
    readonly helpers: SshHelpers;
    /** The system-wide ssh config, which the wrapper config includes because `-F` skips it (D-21). */
    readonly systemConfig: string;
    readonly logLevel: SshLogLevel;
}

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * The OpenSSH client and helpers on `platform`: on macOS `/usr/bin/ssh` and the sh helpers in `resources/bin`; on
 * Windows the OpenSSH that ships with Windows and the bundled `trcd.exe`'s `askpass` and `known-hosts` subcommands
 * (US-6.1.2, D-66). Windows OpenSSH runs `SSH_ASKPASS` as a command line, so it can carry the subcommand (S9).
 */
export function platformSsh(
    platform: NodeJS.Platform,
    resources: string,
    arch: string = process.arch,
    env: Environment = process.env,
): PlatformSsh {
    if (platform !== 'win32') {
        const bin = join(resources, 'bin');
        return {
            ssh: '/usr/bin/ssh',
            helpers: { askpass: join(bin, 'askpass'), knownHosts: join(bin, 'known-hosts') },
            systemConfig: '/etc/ssh/ssh_config',
            logLevel: 'ERROR',
        };
    }
    const trcd = windowsTrcd(resources, arch);
    return {
        ssh: `${env['SystemRoot'] ?? 'C:\\Windows'}\\System32\\OpenSSH\\ssh.exe`,
        helpers: { askpass: `${quoteForSsh(trcd)} askpass`, knownHosts: trcd, knownHostsArgs: ['known-hosts'] },
        systemConfig: `${env['ProgramData'] ?? 'C:\\ProgramData'}\\ssh\\ssh_config`.replaceAll('\\', '/'),
        logLevel: 'INFO',
    };
}

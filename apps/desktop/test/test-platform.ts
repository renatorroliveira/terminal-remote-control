import { join, resolve } from 'node:path';
import type { ConnectionRuntime } from '../src/connection-host/connection/host-connection';
import { platformSsh } from '../src/connection-host/ssh/platform-ssh';

/** The app's bundled resources in the repository. */
const RESOURCES = resolve(import.meta.dirname, '../resources');

/** The ssh, ssh-add and ssh-keygen the live tests run directly: Windows' own by absolute path (D-66), else PATH's. */
export function testSshTool(name: 'ssh' | 'ssh-add' | 'ssh-keygen'): string {
    return process.platform === 'win32'
        ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'OpenSSH', `${name}.exe`)
        : name;
}

/**
 * docker's `--context` for the test hosts: colima's `trc` profile on macOS unless `DOCKER_CONTEXT` names another, and
 * the current context elsewhere, such as Docker Desktop's on Windows (D-69).
 */
export function dockerContextArguments(): readonly string[] {
    const context = process.env['DOCKER_CONTEXT'] ?? (process.platform === 'darwin' ? 'colima-trc' : undefined);
    return context === undefined ? [] : ['--context', context];
}

/** The ssh, helpers and system config a test runtime uses on this OS, as the app's runtime picks them. */
export function testRuntimeSsh(): Pick<ConnectionRuntime, 'ssh' | 'helpers' | 'systemSshConfig' | 'sshLogLevel'> {
    const { ssh, helpers, systemConfig, logLevel } = platformSsh(process.platform, RESOURCES);
    return { ssh, helpers, systemSshConfig: systemConfig, sshLogLevel: logLevel };
}

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repository = resolve(import.meta.dirname, '../../..');

/** Whether tools/test-hosts/macos/up.sh runs the macOS test host (P-57). */
export const MAC_HOST_UP = existsSync(join(repository, 'tools/test-hosts/.run/macos.ssh_config'));

/**
 * The macOS test host's users while it runs, else none: `trc-mac-gui`, with a GUI login, whose daemon is a
 * LaunchAgent, and `trc-mac-nogui`, without one, whose daemon runs detached (US-4.5.2).
 */
export const MAC_HOSTS: readonly ('trc-mac-gui' | 'trc-mac-nogui')[] = MAC_HOST_UP
    ? ['trc-mac-gui', 'trc-mac-nogui']
    : [];

/**
 * A shell command that boots out the LaunchAgent of the install at `root`, a path the host's shell expands such as
 * `~/.trc-x` or `$HOME/.trc-x`, and deletes its plist, as removing the daemon does, so a test's agent never outlives
 * its install (P-58); it does nothing where launchctl is absent.
 */
export function bootOutAgent(root: string): string {
    return [
        `if command -v launchctl >/dev/null 2>&1 && [ -d ${root} ]; then`,
        `label=dev.trc.trcd-$(cd ${root} && pwd -P | tr -d '\\n' | shasum -a 256 | cut -c1-8);`,
        'launchctl bootout "gui/$(id -u)/$label" 2>/dev/null; rm -f ~/Library/LaunchAgents/"$label".plist;',
        'fi',
    ].join(' ');
}

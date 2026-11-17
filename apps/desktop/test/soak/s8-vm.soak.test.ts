// Spike S8 (E4 plan ST-52), throwaway (P-06): the macOS daemon on a tart VM, for a user without a GUI login and for
// the auto-login GUI user under a LaunchAgent; reboots, logout, privacy prompts and the x86_64 slice.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import type { SessionInfo } from '@trc/protocol';
import { describe, expect, it } from 'vitest';
import { connectLive, type LiveHost, reconnectLive, ssh, waitFor } from '../nfr/live-host';

const phase = process.env['TRC_S8_PHASE'];
const report = (step: string, value: unknown) =>
    appendFileSync(
        `${process.env['HOME']}/tmp/suites/s8-report.log`,
        `S8 ${phase} ${step}: ${JSON.stringify(value)}\n`,
    );

async function listed(host: LiveHost): Promise<readonly SessionInfo[]> {
    const { message } = await host.request({ type: 'listSessions', requestId: 90_000 }, 'sessions');
    return message.sessions;
}

async function running(host: LiveHost, id: string): Promise<SessionInfo> {
    for (let attempt = 0; attempt < 120; attempt += 1) {
        const info = (await listed(host)).find((session) => session.id === id);
        if (info?.state === 'running') {
            return info;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`session ${id} does not run`);
}

function trySsh(alias: string, script: string): string {
    try {
        return ssh(alias, script).trim();
    } catch (error) {
        return `failed: ${String(error).slice(0, 200)}`;
    }
}

async function sshBack(alias: string, timeoutMs = 300_000): Promise<void> {
    const started = performance.now();
    for (;;) {
        if (trySsh(alias, 'echo up') === 'up') {
            return;
        }
        if (performance.now() - started > timeoutMs) {
            throw new Error(`${alias} did not come back`);
        }
        await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
}

async function rebootVm(): Promise<void> {
    trySsh('trc-mac-gui', 'sudo shutdown -r now >/dev/null 2>&1 &');
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    report(
        'tart after reboot',
        execFileSync('tart', ['list'], { encoding: 'utf8' })
            .split('\n')
            .find((l) => l.includes('trc-mac ')),
    );
    await sshBack('trc-mac-gui');
}

async function printAndSave(host: LiveHost, alias: string, id: string, marker: string): Promise<void> {
    const session = await host.attach(id);
    const echoed = session.next(marker, 15_000);
    session.type(`echo ${marker.slice(0, 3)}''${marker.slice(3)}\r`);
    await echoed;
    const file = `$HOME/${host.root}/sessions/${id}/scrollback.log`;
    await waitFor(() => trySsh(alias, `grep -c ${marker} ${file} || true`).endsWith('1'), 15_000);
}

function tccLog(): string {
    return trySsh(
        'trc-mac-gui',
        `sudo log show --last 3m --style compact --predicate 'subsystem == "com.apple.TCC"' 2>/dev/null | grep -iE "trcd|AUTHREQ|prompt|Documents|Desktop" | tail -12`,
    );
}

describe.skipIf(phase !== 'nogui')('S8 without a GUI login', () => {
    it('keeps sessions across ssh, restores them after a reboot', async () => {
        const alias = 'trc-mac-nogui';
        let host = await connectLive(alias);
        report('connected', host.states.at(-1));
        const created = await host.session();
        const before = await running(host, created.id);
        report('session', { id: created.id, pid: before.pid });
        await printAndSave(host, alias, created.id, 's8-before-reboot');
        report('processes', trySsh(alias, `ps -axo pid,pgid,sess,ppid,comm | grep -E "trcd|zsh|PID" | grep -v grep`));
        report(
            'x86_64 slice',
            trySsh(
                alias,
                `arch -x86_64 $HOME/${host.root}/versions/*/trcd --version; lipo -archs $HOME/${host.root}/versions/*/trcd`,
            ),
        );

        const tcc = await host.attach(created.id);
        const probed = tcc.next('tcc-done', 20_000);
        tcc.type(`ls ~/Documents ~/Desktop ~/Downloads >/dev/null 2>&1; echo tcc-$?; echo tcc-''done\r`);
        await probed;
        report('tcc probe', tcc.tail().slice(-200));
        report('tcc log', tccLog());

        host.connection.close();
        await new Promise((resolve) => setTimeout(resolve, 20_000));
        report('alive after ssh closed 20 s', trySsh(alias, `kill -0 ${before.pid} && echo alive || echo gone`));
        host = await reconnectLive(alias, host.root);
        const again = await running(host, created.id);
        expect(again.pid).toBe(before.pid);
        report('same shell after reconnect', again.pid);

        host.connection.close();
        await rebootVm();
        await sshBack(alias);
        report('core after reboot, before connect', trySsh(alias, 'pgrep -fl "trcd core" || echo none'));
        host = await reconnectLive(alias, host.root);
        const restored = await running(host, created.id);
        report('after reboot', { pid: restored.pid, restored: restored.restored });
        const view = await host.attach(created.id);
        await waitFor(() => view.tail().includes('s8-before-reboot'), 15_000);
        report('scrollback after reboot', view.tail().slice(-300));
        host.connection.close();
        report('root', host.root);
    });
});

describe.skipIf(phase !== 'gui')('S8 with a GUI login under a LaunchAgent', () => {
    it('keeps holders across the agent, then checks logout and reboot', async () => {
        const alias = 'trc-mac-gui';
        let host = await connectLive(alias);
        report('connected', host.states.at(-1));
        const root = host.root;
        const created = await host.session();
        const before = await running(host, created.id);
        report('session', { id: created.id, pid: before.pid });
        host.connection.close();
        const label = `dev.trc.test-s8${root.slice(-8)}`;
        const plist = `$HOME/Library/LaunchAgents/${label}.plist`;
        const binary = trySsh(alias, `ls $HOME/${root}/versions/*/trcd`);
        report(
            'agent',
            trySsh(
                alias,
                `pkill -f "${root}/versions/.*/trcd core"; sleep 1
mkdir -p $HOME/Library/LaunchAgents
cat > ${plist} <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${binary}</string><string>core</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>AbandonProcessGroup</key><true/>
<key>StandardErrorPath</key><string>$HOME/${root}/agent.err</string>
</dict></plist>
EOF
launchctl bootstrap gui/$(id -u) ${plist} && echo bootstrapped; sleep 2; launchctl print gui/$(id -u)/${label} | grep -E "state|pid =" | head -3; cat $HOME/${root}/agent.err 2>/dev/null | tail -3`,
            ),
        );
        host = await reconnectLive(alias, root);
        const adopted = await running(host, created.id);
        report('adopted by the agent core', { pid: adopted.pid, same: adopted.pid === before.pid });

        const agentSession = await host.session();
        const agentInfo = await running(host, agentSession.id);
        report('session under agent', agentInfo.pid);
        await printAndSave(host, alias, agentSession.id, 's8-before-logout');
        host.connection.close();

        report(
            'logout',
            trySsh(
                alias,
                `sudo launchctl asuser $(id -u) sudo -u $(id -un) osascript -e 'tell application "loginwindow" to «event aevtrlgo»' 2>&1; echo sent`,
            ),
        );
        await new Promise((resolve) => setTimeout(resolve, 20_000));
        report('after logout', {
            gui: trySsh(alias, 'launchctl print gui/$(id -u) >/dev/null 2>&1 && echo gui || echo no-gui'),
            holders: trySsh(
                alias,
                `for p in ${before.pid} ${agentInfo.pid}; do kill -0 $p 2>/dev/null && echo $p alive || echo $p gone; done`,
            ),
            core: trySsh(alias, 'pgrep -fl "trcd core" || echo none'),
            agent: trySsh(alias, `launchctl print gui/$(id -u)/${label} 2>&1 | grep -E "state|pid =" | head -2`),
        });

        host = await reconnectLive(alias, root);
        const afterLogout = await running(host, agentSession.id);
        report('reconnected after logout', {
            pid: afterLogout.pid,
            same: afterLogout.pid === agentInfo.pid,
            service: host.states.at(-1),
        });
        const typed = await host.attach(agentSession.id);
        const echoed = typed.next('s8-after-logout', 15_000);
        typed.type("echo s8-''after-logout\r");
        await echoed;
        report('typing after logout', 'ok');
        host.connection.close();
        await rebootVm();
        await new Promise((resolve) => setTimeout(resolve, 15_000));
        report('after reboot, before connect', {
            gui: trySsh(alias, 'launchctl print gui/$(id -u) >/dev/null 2>&1 && echo gui || echo no-gui'),
            core: trySsh(alias, 'pgrep -fl "trcd core" || echo none'),
            agent: trySsh(alias, `launchctl print gui/$(id -u)/${label} 2>&1 | grep -E "state|pid =|runs" | head -3`),
            shells: trySsh(alias, `ps -axo pid,ppid,comm | grep -E "trcd holder|zsh" | grep -v grep | head`),
        });
        host = await reconnectLive(alias, root);
        const restored = await running(host, agentSession.id);
        report('restored', { pid: restored.pid, restored: restored.restored });
        const view = await host.attach(agentSession.id);
        await waitFor(() => view.tail().includes('s8-before-logout'), 15_000);
        report('scrollback', view.tail().slice(-300));
        report('tcc log after reboot', tccLog());
        host.connection.close();
        report('cleanup', trySsh(alias, `launchctl bootout gui/$(id -u)/${label}; rm -f ${plist}; echo done`));
        report('root', root);
    });
});

import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalTransport, localEnvironment } from './local-transport';

const ENV = {
    HOME: '/home/tester',
    USER: 'tester',
    LOGNAME: 'tester',
    SHELL: '/bin/zsh',
    PATH: '/usr/bin:/bin',
    SSH_AUTH_SOCK: '/tmp/agent.sock',
    SECRET_TOKEN: 'never-passed',
    ELECTRON_RUN_AS_NODE: '1',
};

describe('localEnvironment (P-59)', () => {
    it('passes on only the account and path variables, those the LaunchAgent keeps', () => {
        expect(localEnvironment({ env: ENV })).toEqual({
            HOME: '/home/tester',
            USER: 'tester',
            LOGNAME: 'tester',
            SHELL: '/bin/zsh',
            PATH: '/usr/bin:/bin',
        });
    });

    it('gives a test build’s daemon its scratch home (P-58)', () => {
        expect(localEnvironment({ env: ENV, home: '/tmp/scratch' })['HOME']).toBe('/tmp/scratch');
    });
});

describe('LocalTransport (US-4.2.4, P-59)', () => {
    it('runs what it is sent in /bin/sh, in the home folder, with the local environment', async () => {
        const home = realpathSync(mkdtempSync(join(tmpdir(), 'trc-local-')));
        const transport = new LocalTransport({ env: ENV, home });
        expect(await transport.check()).toBeUndefined();
        const channel = await transport.open();
        const output: string[] = [];
        channel.child.stdout.setEncoding('utf8');
        channel.child.stdout.on('data', (chunk: string) => output.push(chunk));
        channel.child.stdin.end('pwd; echo "$HOME $SECRET_TOKEN."; echo oops >&2; exit 3\n');
        expect(await channel.exited).toBe(3);
        expect(output.join('')).toBe(`${home}\n${home} .\n`);
        expect(await transport.closed(channel)).toEqual({ kind: 'other', details: 'oops' });
    });
});

import type { SessionInfo } from '@trc/protocol';
import { createIntl } from 'react-intl';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { EMPTY_WORKSPACE, type Workspace } from '../sessions/workspace-model';
import type { CommandMove, CommandOutput } from '../terminal/command-navigator';
import { CommandActions, type CommandSettings, READ_LINES } from './command-actions';
import type { AudioCue } from './sound/audio-cues';

const intl = createIntl({ locale: 'en', defaultLocale: 'en', messages: {} });

function session(integration: SessionInfo['integration']): SessionInfo {
    return {
        id: 's1',
        order: 0,
        state: 'running',
        profile: {
            id: 'sh',
            name: 'sh',
            origin: 'detected',
            kind: 'sh',
            path: '/bin/sh',
            args: [],
            login: false,
            env: {},
            integration: 'auto',
        },
        size: { cols: 80, rows: 24 },
        ...(integration === undefined ? {} : { integration }),
    };
}

function workspaceWith(integration: SessionInfo['integration']): Workspace {
    const host = {
        id: 'h1',
        destination: 'devbox-1',
        state: { kind: 'connected' },
        reconnecting: false,
    } as unknown as Workspace['hosts'][number];
    return { ...EMPTY_WORKSPACE, hosts: [host], sessions: new Map([['h1', [session(integration)]]]), open: 'h1/s1' };
}

function setUp(options: {
    readonly move?: CommandMove;
    readonly output?: CommandOutput;
    readonly integration?: SessionInfo['integration'];
    readonly settings?: Partial<CommandSettings>;
    readonly copies?: boolean;
}) {
    const said: string[] = [];
    const cues: AudioCue[] = [];
    const copied: string[] = [];
    let noSession = 0;
    const actions = new CommandActions({
        terminals: {
            commandStep: () => options.move,
            lastCommandOutput: () => options.output,
            selectLastCommandOutput: () => options.output,
        },
        workspace: () => workspaceWith(options.integration),
        intl,
        announcer: { announce: (text) => said.push(text) },
        playCue: (cue) => cues.push(cue),
        settings: () => ({ ...DEFAULT_SETTINGS, ...options.settings }),
        copy: async (text) => {
            copied.push(text);
            return options.copies ?? true;
        },
        noSession: () => {
            noSession += 1;
        },
    });
    return { actions, said, cues, copied, noSessions: () => noSession };
}

describe('CommandActions: moving and reading (US-5.2.1)', () => {
    it('says the command it moved to, and whether it failed or still runs', () => {
        const moved = setUp({ move: { kind: 'moved', line: '$ make test', exitCode: 2, running: false } });
        moved.actions.actions()['command.previous']?.();
        const running = setUp({ move: { kind: 'moved', line: '$ sleep 9', exitCode: undefined, running: true } });
        running.actions.actions()['command.next']?.();
        const edge = setUp({ move: { kind: 'edge', direction: 'previous' } });
        edge.actions.actions()['command.previous']?.();
        expect([...moved.said, ...running.said, ...edge.said]).toEqual([
            '$ make test. Failed, exit code 2.',
            '$ sleep 9. Still running.',
            'No earlier command.',
        ]);
    });

    it('reads the output, only its last lines when it is long, and says when there was none', () => {
        const short = setUp({ output: { kind: 'output', text: 'one\ntwo', lines: 2 } });
        short.actions.actions()['command.readOutput']?.();
        const lines = Array.from({ length: READ_LINES + 20 }, (_, index) => `l${index}`);
        const long = setUp({ output: { kind: 'output', text: lines.join('\n'), lines: lines.length } });
        long.actions.actions()['command.readOutput']?.();
        const empty = setUp({ output: { kind: 'output', text: '', lines: 0 } });
        empty.actions.actions()['command.readOutput']?.();
        expect(short.said).toEqual(['one\ntwo']);
        expect(long.said[0]).toBe(`Last ${READ_LINES} of ${lines.length} lines: ${lines.slice(20).join('\n')}`);
        expect(empty.said).toEqual(['The last command printed nothing.']);
    });

    it('selects and copies the output, and says how many lines', async () => {
        const { actions, said, copied } = setUp({ output: { kind: 'output', text: 'one\ntwo', lines: 2 } });
        actions.actions()['command.selectOutput']?.();
        actions.actions()['command.copyOutput']?.();
        await expect.poll(() => said).toHaveLength(2);
        expect(said).toEqual([
            'Selected the last command’s output, 2 lines.',
            'Copied the last command’s output, 2 lines.',
        ]);
        expect(copied).toEqual(['one\ntwo']);
    });

    it('says when the clipboard refused the output, and that no session is open without one', async () => {
        const refused = setUp({ output: { kind: 'output', text: 'x', lines: 1 }, copies: false });
        refused.actions.actions()['command.copyOutput']?.();
        const none = setUp({});
        none.actions.actions()['command.previous']?.();
        none.actions.actions()['command.readOutput']?.();
        await expect.poll(() => refused.said).toEqual(['The last command’s output couldn’t be copied.']);
        expect(none.noSessions()).toBe(2);
    });
});

describe('CommandActions: why commands can’t be reached (US-5.2.3)', () => {
    it('names the reason from the session’s shell integration', () => {
        const unavailable: CommandMove = { kind: 'unavailable', reason: 'none' };
        const said = (['off', 'unsupported', 'injected', undefined] as const).map((integration) => {
            const actions = setUp({ move: unavailable, integration });
            actions.actions.actions()['command.next']?.();
            return actions.said[0];
        });
        expect(said).toEqual([
            'Moving between commands needs shell integration, which is off for devbox-1. Turn it on in Settings, under Hosts; it applies when a shell next starts.',
            'Moving between commands needs shell integration, which bash, zsh and fish have and sh doesn’t.',
            'No command has run in this session yet.',
            'Moving between commands needs shell integration, which this session’s shell started without. Restart the session to add it.',
        ]);
        const fullScreen = setUp({ move: { kind: 'unavailable', reason: 'full-screen' } });
        fullScreen.actions.actions()['command.previous']?.();
        expect(fullScreen.said).toEqual(['Commands can’t be reached while a full-screen program runs.']);
    });
});

describe('CommandActions: a command finished in the open session (US-5.2.2)', () => {
    it('announces a failure and plays its cue, plays the success cue only when on, and ignores other sessions', () => {
        const { actions, said, cues } = setUp({ settings: { commandSucceededCue: true } });
        actions.finished('h1/s1', 2);
        actions.finished('h1/s1', 0);
        actions.finished('h1/s1', undefined);
        actions.finished('h1/other', 1);
        expect(said).toEqual(['Command failed, exit code 2.']);
        expect(cues).toEqual(['command-failed', 'command-succeeded']);
    });

    it('stays quiet when the announcement and the cues are off', () => {
        const off = { announceFailedCommands: false, commandFailedCue: false, commandSucceededCue: false };
        const { actions, said, cues } = setUp({ settings: off });
        actions.finished('h1/s1', 1);
        actions.finished('h1/s1', 0);
        expect([said, cues]).toEqual([[], []]);
    });
});

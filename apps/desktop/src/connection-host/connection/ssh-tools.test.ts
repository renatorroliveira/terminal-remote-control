import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentState, expandHome } from './ssh-tools';

describe('expandHome', () => {
    it('expands ~/ everywhere and ~\\ on Windows only', () => {
        expect(expandHome('~/.ssh/kh', '/home/a', 'darwin')).toBe(join('/home/a', '/.ssh/kh'));
        expect(expandHome('~\\.ssh\\kh', 'C:\\Users\\a', 'win32')).toBe(join('C:\\Users\\a', '\\.ssh\\kh'));
        expect(expandHome('~\\kh', '/home/a', 'darwin')).toBe('~\\kh');
        expect(expandHome('/abs', '/home/a', 'darwin')).toBe('/abs');
    });
});

describe('agentState (US-1.3.1, P-89)', () => {
    it("reads ssh-add -l's exit code", () => {
        expect(agentState(0, '', {})).toBe('loaded');
        expect(agentState(1, '.exe', {})).toBe('empty');
        expect(agentState(2, '', {})).toBe('none');
    });

    it("names Windows' agent service when no agent answers and SSH_AUTH_SOCK names none", () => {
        expect(agentState(2, '.exe', {})).toBe('windows-agent-off');
        expect(agentState(2, '.exe', { SSH_AUTH_SOCK: '\\\\.\\pipe\\other-agent' })).toBe('none');
    });
});

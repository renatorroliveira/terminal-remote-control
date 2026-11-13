import { describe, expect, it } from 'vitest';
import { type CommandLineSwitches, refuseRemoteDebugging } from './debugging-guard';

function commandLine(switches: readonly string[]): CommandLineSwitches & { readonly left: Set<string> } {
    const left = new Set(switches);
    return {
        left,
        hasSwitch: (name) => left.has(name),
        removeSwitch: (name) => {
            left.delete(name);
        },
    };
}

describe('refuseRemoteDebugging', () => {
    it('drops every switch that would open a DevTools endpoint in a release build (SEC-01)', () => {
        const line = commandLine(['remote-debugging-port', 'remote-debugging-pipe', 'remote-allow-origins', 'lang']);
        expect(refuseRemoteDebugging(line, { testBuild: false })).toEqual([
            'remote-debugging-port',
            'remote-debugging-pipe',
            'remote-allow-origins',
        ]);
        expect([...line.left]).toEqual(['lang']);
    });

    it('keeps them in a test build, which Playwright drives through the DevTools protocol (P-14)', () => {
        const line = commandLine(['remote-debugging-port']);
        expect(refuseRemoteDebugging(line, { testBuild: true })).toEqual([]);
        expect([...line.left]).toEqual(['remote-debugging-port']);
    });
});

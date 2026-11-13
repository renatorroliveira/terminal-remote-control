import { describe, expect, it } from 'vitest';
import { parseArguments } from './arguments.ts';

describe('parseArguments', () => {
    it('takes the bump and an optional --dry-run', () => {
        expect(parseArguments(['minor'])).toEqual({ bump: 'minor', dryRun: false });
        expect(parseArguments(['patch', '--dry-run'])).toEqual({ bump: 'patch', dryRun: true });
    });

    it('refuses anything else, with the usage', () => {
        expect(() => parseArguments([])).toThrow(/usage: pnpm release <major\|minor\|patch> \[--dry-run\]/);
        expect(() => parseArguments(['huge'])).toThrow(/usage/);
        expect(() => parseArguments(['minor', '--force'])).toThrow(/usage/);
    });
});

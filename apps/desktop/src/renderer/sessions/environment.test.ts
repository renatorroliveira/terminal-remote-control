import { describe, expect, it } from 'vitest';
import { parseEnvironment } from './environment';

describe('parseEnvironment: the New session dialog’s overrides (US-1.7.2)', () => {
    it('reads NAME=value lines, NAME= as removal, and skips blank lines', () => {
        expect(parseEnvironment('EDITOR=vim\n\n  PAGER = less -R \nOLD=\n')).toEqual({
            EDITOR: 'vim',
            PAGER: 'less -R',
            OLD: null,
        });
        expect(parseEnvironment('')).toEqual({});
    });

    it('refuses a line without = or with a name a shell cannot use', () => {
        expect(parseEnvironment('JUST_A_NAME')).toBeUndefined();
        expect(parseEnvironment('1BAD=x')).toBeUndefined();
        expect(parseEnvironment('BAD-NAME=x')).toBeUndefined();
    });
});

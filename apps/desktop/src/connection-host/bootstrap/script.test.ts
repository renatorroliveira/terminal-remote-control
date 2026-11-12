import { describe, expect, it } from 'vitest';
import { buildBootstrapScript } from './script';

describe('buildBootstrapScript', () => {
    it('prepends the nonce and the install root as quoted assignments', () => {
        const script = buildBootstrapScript('main\n', { nonce: 'a1b2', root: '~/.trc' });
        expect(script).toBe("TRC_NONCE='a1b2'\nTRC_ROOT='~/.trc'\nmain\n");
    });

    it('quotes single quotes and spaces in the root', () => {
        const script = buildBootstrapScript('main\n', { nonce: 'ab', root: "/var/tmp/it's here" });
        expect(script).toContain("TRC_ROOT='/var/tmp/it'\\''s here'\n");
    });

    it.each(['relative/path', '/a\nb', '/a\0b', '~user/x', ''])('refuses the root %j', (root) => {
        expect(() => buildBootstrapScript('main\n', { nonce: 'ab', root })).toThrow(/install location/);
    });

    it('refuses a nonce that is not hexadecimal', () => {
        expect(() => buildBootstrapScript('main\n', { nonce: "x'; rm", root: '~/.trc' })).toThrow(/nonce/);
    });
});

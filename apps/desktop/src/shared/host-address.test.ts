import { describe, expect, it } from 'vitest';
import { formatHostAddress, parseHostAddress } from './host-address';

describe('parseHostAddress (US-1.1.1)', () => {
    it('reads an SSH alias, user@host, and an optional port', () => {
        expect(parseHostAddress('devbox-1')).toEqual({ destination: 'devbox-1' });
        expect(parseHostAddress(' me@10.0.0.5 ')).toEqual({ destination: 'me@10.0.0.5' });
        expect(parseHostAddress('me@build.example.com:2222')).toEqual({
            destination: 'me@build.example.com',
            port: 2222,
        });
    });

    it('keeps a bare IPv6 address whole, and reads a bracketed one with its port', () => {
        expect(parseHostAddress('fe80::1')).toEqual({ destination: 'fe80::1' });
        expect(parseHostAddress('[fe80::1]:2200')).toEqual({ destination: 'fe80::1', port: 2200 });
    });

    it('refuses empty text, spaces, a leading dash and impossible ports', () => {
        for (const text of ['', '   ', 'two words', '-oProxyCommand=x', 'host:0', 'host:70000']) {
            expect(parseHostAddress(text)).toBeUndefined();
        }
    });

    it('formats an address back the way the user typed it', () => {
        expect(formatHostAddress({ destination: 'me@host', port: 2222 })).toBe('me@host:2222');
        expect(formatHostAddress({ destination: 'fe80::1', port: 22 })).toBe('[fe80::1]:22');
        expect(formatHostAddress({ destination: 'devbox-1' })).toBe('devbox-1');
    });
});

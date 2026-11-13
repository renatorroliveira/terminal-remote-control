import { describe, expect, it } from 'vitest';
import { trcHome } from './trc-home';

describe('trcHome: the folder that holds the app config and known hosts', () => {
    it('is ~/.trc by default', () => {
        expect(trcHome({}, '/home/tester')).toBe('/home/tester/.trc');
        expect(trcHome({ TRC_HOME: '' }, '/home/tester')).toBe('/home/tester/.trc');
    });

    it('is TRC_HOME when set, with ~ meaning the home folder and relative paths under it', () => {
        expect(trcHome({ TRC_HOME: '/tmp/trc-dev' }, '/home/tester')).toBe('/tmp/trc-dev');
        expect(trcHome({ TRC_HOME: '~/.trc-dev' }, '/home/tester')).toBe('/home/tester/.trc-dev');
        expect(trcHome({ TRC_HOME: 'trc-dev' }, '/home/tester')).toBe('/home/tester/trc-dev');
    });
});

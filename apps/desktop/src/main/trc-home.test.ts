import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { trcHome } from './trc-home';

/** An absolute home folder on this OS. */
const HOME = resolve('/home/tester');

describe('trcHome: the folder that holds the app config and known hosts', () => {
    it('is ~/.trc by default', () => {
        expect(trcHome({}, HOME)).toBe(join(HOME, '.trc'));
        expect(trcHome({ TRC_HOME: '' }, HOME)).toBe(join(HOME, '.trc'));
    });

    it('is TRC_HOME when set, with ~ meaning the home folder and relative paths under it', () => {
        expect(trcHome({ TRC_HOME: resolve('/tmp/trc-dev') }, HOME)).toBe(resolve('/tmp/trc-dev'));
        expect(trcHome({ TRC_HOME: '~/.trc-dev' }, HOME)).toBe(join(HOME, '.trc-dev'));
        expect(trcHome({ TRC_HOME: 'trc-dev' }, HOME)).toBe(join(HOME, 'trc-dev'));
    });

    it('reads ~\\ as the home folder on Windows (P-95)', () => {
        expect(trcHome({ TRC_HOME: '~\\.trc-dev' }, HOME, 'win32')).toBe(join(HOME, '.trc-dev'));
    });
});

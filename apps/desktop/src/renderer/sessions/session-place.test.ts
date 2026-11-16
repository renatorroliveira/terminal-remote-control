import { describe, expect, it } from 'vitest';
import { sessionPlace } from './session-place';

const HOME = '/home/jordan';

describe('sessionPlace: the last two folders of a working directory (P-48)', () => {
    it.each([
        ['/home/jordan', '~'],
        ['/home/jordan/', '~'],
        ['/home/jordan/src', '~/src'],
        ['/home/jordan/src/trc', 'src/trc'],
        ['/home/jordan/src/trc/apps', 'trc/apps'],
        ['/home/jordanna/x', 'jordanna/x'],
        ['/', '/'],
        ['/etc', '/etc'],
        ['/var/log', '/var/log'],
        ['/var/log/nginx', 'log/nginx'],
        ['//var//log///', '/var/log'],
    ])('shows %s as %s, the home folder as ~ counted as one folder', (cwd, place) => {
        expect(sessionPlace(cwd, HOME)).toBe(place);
    });

    it('keeps the whole path when the home folder is unknown or the root', () => {
        expect(sessionPlace('/home/jordan/src', undefined)).toBe('jordan/src');
        expect(sessionPlace('/srv/app', '/')).toBe('/srv/app');
    });

    it('shows nothing without an absolute working directory', () => {
        expect(sessionPlace(undefined, HOME)).toBeUndefined();
        expect(sessionPlace('', HOME)).toBeUndefined();
        expect(sessionPlace('src/trc', HOME)).toBeUndefined();
    });

    it('strips control characters, as working directories come from the host (SEC-06.4)', () => {
        expect(sessionPlace('/home/jordan/a\u001b[31mb', HOME)).toBe('~/a[31mb');
    });
});

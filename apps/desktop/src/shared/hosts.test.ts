import { describe, expect, it } from 'vitest';
import { isInstallRoot } from './hosts';

describe('isInstallRoot (US-1.4.3)', () => {
    it('accepts the home folder, a folder under it, or an absolute folder', () => {
        expect(['~', '~/.trc', '/var/tmp/trc', '/srv/team/trc'].map(isInstallRoot)).toEqual([true, true, true, true]);
    });

    it('refuses /, relative folders, and names with a newline or NUL', () => {
        expect(['/', '//', 'trc', '', '~user/trc', '/a\nb', '/a\0b'].map(isInstallRoot)).toEqual([
            false,
            false,
            false,
            false,
            false,
            false,
            false,
        ]);
    });
});

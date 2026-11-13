import { describe, expect, it } from 'vitest';
import { ICONSET_ENTRIES } from './icon-sizes.ts';

describe('ICONSET_ENTRIES', () => {
    it('names every size iconutil needs for a macOS icon', () => {
        expect(ICONSET_ENTRIES.map((entry) => `${entry.file}:${entry.size}`)).toEqual([
            'icon_16x16.png:16',
            'icon_16x16@2x.png:32',
            'icon_32x32.png:32',
            'icon_32x32@2x.png:64',
            'icon_128x128.png:128',
            'icon_128x128@2x.png:256',
            'icon_256x256.png:256',
            'icon_256x256@2x.png:512',
            'icon_512x512.png:512',
            'icon_512x512@2x.png:1024',
        ]);
    });
});

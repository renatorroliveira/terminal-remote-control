import { describe, expect, it } from 'vitest';
import { brandingSteps } from './brand-electron.ts';

const NAME = 'Terminal Remote Control';

describe('brandingSteps: what the development Electron.app needs to carry the product name and icon', () => {
    it('renames the bundle, swaps the icon and re-signs it when either differs', () => {
        expect(brandingSteps({ name: 'Electron', displayName: 'Electron', iconMatches: false }, NAME)).toEqual([
            'rename',
            'icon',
            'sign',
        ]);
        expect(brandingSteps({ name: NAME, displayName: NAME, iconMatches: false }, NAME)).toEqual(['icon', 'sign']);
        expect(brandingSteps({ name: NAME, displayName: 'Electron', iconMatches: true }, NAME)).toEqual([
            'rename',
            'sign',
        ]);
    });

    it('does nothing to a bundle that is already branded', () => {
        expect(brandingSteps({ name: NAME, displayName: NAME, iconMatches: true }, NAME)).toEqual([]);
    });
});

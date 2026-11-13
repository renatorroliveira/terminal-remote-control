import { describe, expect, it } from 'vitest';
import { guideNavigation, guideUrl } from './user-guide';

describe('the user guide window (A11Y-10.4, P-18)', () => {
    it('opens the guide, or one of its sections', () => {
        expect(guideUrl(undefined)).toBe('app://docs/index.html');
        expect(guideUrl('voiceover')).toBe('app://docs/index.html#quick-start-with-voiceover');
    });

    it('stays in the guide, sends web links to the browser, and goes nowhere else', () => {
        expect(guideNavigation('app://docs/index.html#install')).toBe('allow');
        expect(guideNavigation('https://github.com/renatorroliveira/terminal-remote-control/releases')).toBe(
            'external',
        );
        expect(guideNavigation('app://trc/index.html')).toBe('deny');
        expect(guideNavigation('file:///etc/passwd')).toBe('deny');
        expect(guideNavigation('javascript:alert(1)')).toBe('deny');
    });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDE_SECTIONS } from '../shared/guide';
import { guideNavigation, guideUrl } from './user-guide';

describe('the user guide window (A11Y-10.4, P-18)', () => {
    it('opens the guide, or one of its sections', () => {
        expect(guideUrl(undefined)).toBe('app://docs/index.html');
        expect(guideUrl('voiceover')).toBe('app://docs/index.html#quick-start-with-voiceover');
    });

    it('opens only sections the rendered guide has, the Windows screen readers’ quick start included', () => {
        const guide = readFileSync(resolve(import.meta.dirname, '../../resources/docs/index.html'), 'utf8');
        for (const id of Object.values(GUIDE_SECTIONS)) {
            expect(guide).toContain(`id="${id}"`);
        }
        expect(guideUrl('windows-screen-readers')).toBe('app://docs/index.html#quick-start-with-nvda-jaws-or-narrator');
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

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GUIDE_PATHS, renderGuide } from './guide';

describe('the in-app user guide (A11Y-10.4, P-18)', () => {
    it('is USER_GUIDE.md as committed HTML; run pnpm docs:guide after changing the guide', () => {
        expect(readFileSync(GUIDE_PATHS.output, 'utf8')).toBe(renderGuide());
    });

    it('has a target for every link inside it, the VoiceOver quick start among them', () => {
        const page = renderGuide();
        const ids = new Set([...page.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]));
        const targets = [...page.matchAll(/ href="#([^"]+)"/g)].map((match) => match[1]);
        expect(targets.filter((target) => !ids.has(target))).toEqual([]);
        expect(ids.has('quick-start-with-voiceover')).toBe(true);
    });
});

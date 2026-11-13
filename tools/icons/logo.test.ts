import { describe, expect, it } from 'vitest';
import { logoSvg, smallLogoSvg } from './logo.ts';

describe('the TRC logo: three phosphor terminals linked in a triangle', () => {
    it('draws the same master every time, on the 1024 px macOS icon grid', () => {
        const svg = logoSvg();
        expect(svg).toBe(logoSvg());
        expect(svg).toContain('viewBox="0 0 1024 1024"');
        expect(svg).toContain('<rect x="100" y="100" width="824" height="824" rx="186"');
        expect(svg.match(/data-terminal=/g)).toHaveLength(3);
        expect(svg).toContain('#00ad2c');
        expect(svg).toContain('<title>Terminal Remote Control</title>');
    });

    it('draws a small version for 16 to 32 px without text, glow or shadow', () => {
        const svg = smallLogoSvg();
        expect(svg.match(/data-terminal=/g)).toHaveLength(3);
        expect(svg).not.toContain('filter=');
        expect(svg).not.toContain('data-text');
    });
});

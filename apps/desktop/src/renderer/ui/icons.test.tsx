import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { BusyIcon, ConnectedIcon, DisconnectedIcon } from './icons';

async function shapes(icon: React.ReactElement) {
    const screen = await render(icon);
    const svg = screen.container.querySelector('svg');
    return {
        hidden: svg?.getAttribute('aria-hidden'),
        filled: [...(svg?.querySelectorAll('[fill="currentColor"]') ?? [])].map((shape) => shape.tagName),
        outlined: [...(svg?.querySelectorAll('[stroke="currentColor"]') ?? [])].map((shape) => shape.tagName),
    };
}

describe('the connection state icons (A11Y-07.2: state never by color alone)', () => {
    it('draws a connected host as a filled dot', async () => {
        expect(await shapes(<ConnectedIcon />)).toEqual({ hidden: 'true', filled: ['circle'], outlined: [] });
    });

    it('draws a disconnected host as a hollow ring', async () => {
        expect(await shapes(<DisconnectedIcon />)).toEqual({ hidden: 'true', filled: [], outlined: ['circle'] });
    });

    it('draws a busy host as a ring filled halfway', async () => {
        expect(await shapes(<BusyIcon />)).toEqual({ hidden: 'true', filled: ['path'], outlined: ['circle'] });
    });
});

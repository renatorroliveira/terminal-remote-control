import { afterEach, describe, expect, it } from 'vitest';
import { REGION_ATTRIBUTE } from '../regions';
import { helpContext } from './help-context';

afterEach(() => {
    document.body.replaceChildren();
});

function inRegion(region: string, html: string): HTMLElement {
    const container = document.createElement('div');
    container.setAttribute(REGION_ATTRIBUTE, region);
    container.innerHTML = html;
    document.body.append(container);
    const element = container.firstElementChild;
    if (!(element instanceof HTMLElement)) {
        throw new Error('no element');
    }
    return element;
}

describe('helpContext: where accessibility help was asked for (A11Y-10.1)', () => {
    it('tells review mode, the terminal, the session list and anywhere else apart', () => {
        expect(helpContext(inRegion('terminal', '<textarea data-review></textarea>'))).toBe('review');
        expect(helpContext(inRegion('terminal', '<div role="textbox" tabindex="0"></div>'))).toBe('terminal');
        expect(helpContext(inRegion('sidebar', '<div role="tree"><div role="treeitem"></div></div>'))).toBe('sessions');
        expect(helpContext(inRegion('sidebar', '<button type="button">Add host</button>'))).toBe('general');
        expect(helpContext(null)).toBe('general');
    });
});

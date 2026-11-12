import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { App } from './App';

describe('App', () => {
    it('renders the named main region', async () => {
        const screen = await render(<App />);

        await expect.element(screen.getByRole('main', { name: 'Term Remote Control' })).toBeVisible();
    });

    it('has no WCAG 2.2 A or AA violations', async () => {
        await render(<App />);

        const results = await axe.run(document.body, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
        });
        expect(results.violations).toEqual([]);
    });
});

import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { App } from './App';
import { AppProviders } from './AppProviders';

function renderApp() {
    return render(
        <AppProviders locale="en">
            <App />
        </AppProviders>,
    );
}

describe('App', () => {
    it('renders the named main region with its localized text', async () => {
        const screen = await renderApp();

        await expect.element(screen.getByRole('main', { name: 'Term Remote Control' })).toBeVisible();
        await expect.element(screen.getByText('No session is open.')).toBeVisible();
    });

    it('has no WCAG 2.2 A or AA violations', async () => {
        await renderApp();

        const results = await axe.run(document.body, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
        });
        expect(results.violations).toEqual([]);
    });
});

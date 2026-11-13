import type { SessionInfo } from '@trc/protocol';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { AppProviders } from '../app/AppProviders';
import { SessionList } from './SessionList';
import type { SessionItem } from './workspace-model';
import { bashSession } from './workspace-test-doubles';

const item = (id: string, label: string, state: SessionInfo['state'] = 'running'): SessionItem => ({
    key: `h1/${id}`,
    label,
    session: { ...bashSession(id), state, customName: label },
});

const ITEMS = [item('a', 'build'), item('b', 'logs', 'exited'), item('c', 'deploy')];

async function renderList(onOpen: (key: string) => void = () => undefined) {
    return render(
        <AppProviders locale="en">
            <SessionList id="list" label="Sessions on devbox-1" items={ITEMS} open="h1/b" onOpen={onOpen} />
        </AppProviders>,
    );
}

describe('SessionList (US-1.6.4, US-1.8.1, US-1.9.3)', () => {
    it('is a named listbox whose options say each state in text, with the open session selected', async () => {
        const screen = await renderList();
        await expect.element(screen.getByRole('listbox', { name: 'Sessions on devbox-1' })).toBeVisible();
        await expect
            .element(screen.getByRole('option', { name: 'build, Running' }))
            .toHaveAttribute('aria-selected', 'false');
        await expect
            .element(screen.getByRole('option', { name: 'logs, Exited' }))
            .toHaveAttribute('aria-selected', 'true');
    });

    it('moves focus with the arrows, Home, End and type-ahead, without opening anything', async () => {
        const opened: string[] = [];
        const screen = await renderList((key) => opened.push(key));
        await userEvent.keyboard('{Tab}');
        await expect.element(screen.getByRole('option', { name: 'logs, Exited' })).toHaveFocus();
        await userEvent.keyboard('{ArrowUp}');
        await expect.element(screen.getByRole('option', { name: 'build, Running' })).toHaveFocus();
        await userEvent.keyboard('{End}');
        await expect.element(screen.getByRole('option', { name: 'deploy, Running' })).toHaveFocus();
        await userEvent.keyboard('{Home}l');
        await expect.element(screen.getByRole('option', { name: 'logs, Exited' })).toHaveFocus();
        expect(opened).toEqual([]);
    });

    it('opens a session with Enter, Space or a click', async () => {
        const opened: string[] = [];
        const screen = await renderList((key) => opened.push(key));
        await screen.getByRole('option', { name: 'build, Running' }).click();
        await userEvent.keyboard('{ArrowDown}{Enter}{ArrowDown} ');
        expect(opened).toEqual(['h1/a', 'h1/b', 'h1/c']);
    });

    it('draws a border only on the open session and the one under the pointer', async () => {
        const screen = await renderList();
        const border = (name: string) =>
            getComputedStyle(screen.getByRole('option', { name }).element()).borderTopColor;
        expect(border('build, Running')).toBe('rgba(0, 0, 0, 0)');
        expect(border('logs, Exited')).not.toBe('rgba(0, 0, 0, 0)');
        await screen.getByRole('option', { name: 'deploy, Running' }).hover();
        expect(border('deploy, Running')).not.toBe('rgba(0, 0, 0, 0)');
    });

    it('has no WCAG 2.2 A or AA violations', async () => {
        await renderList();
        const results = await axe.run(document.body, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
        });
        expect(results.violations).toEqual([]);
    });
});

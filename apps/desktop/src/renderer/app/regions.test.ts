import { describe, expect, it, onTestFinished } from 'vitest';
import { RegionCycler } from './regions';

function layout(): { root: HTMLElement; byId: (id: string) => HTMLElement } {
    const root = document.createElement('div');
    root.innerHTML = `
        <nav data-region="sidebar"><button id="first">First</button><button id="second">Second</button></nav>
        <main data-region="terminal"><div id="surface" tabindex="0">terminal</div></main>
        <footer data-region="status"><span>Connected</span><button id="tab-mode">Tab</button></footer>`;
    document.body.append(root);
    onTestFinished(() => root.remove());
    return { root, byId: (id) => root.querySelector<HTMLElement>(`#${id}`) ?? root };
}

describe('RegionCycler: move between the sidebar, the terminal and the status bar (A11Y-05.2)', () => {
    it('moves to the next and previous region, wrapping around, starting from the first control', () => {
        const { byId } = layout();
        const cycler = new RegionCycler(document, {});
        onTestFinished(cycler.start());
        byId('first').focus();
        cycler.next();
        expect(document.activeElement).toBe(byId('surface'));
        cycler.next();
        expect(document.activeElement).toBe(byId('tab-mode'));
        cycler.next();
        expect(document.activeElement).toBe(byId('first'));
        cycler.previous();
        expect(document.activeElement).toBe(byId('tab-mode'));
    });

    it('returns to the control that last had focus in a region, and lets a region choose its own entry', () => {
        const { byId } = layout();
        let entered = 0;
        const cycler = new RegionCycler(document, {
            terminal: () => {
                entered += 1;
                byId('surface').focus();
                return true;
            },
        });
        onTestFinished(cycler.start());
        byId('second').focus();
        cycler.next();
        expect(entered).toBe(1);
        cycler.previous();
        expect(document.activeElement).toBe(byId('second'));
    });

    it('skips a hidden region, and focuses a region without controls itself', () => {
        const { root, byId } = layout();
        root.querySelector<HTMLElement>('nav')?.setAttribute('hidden', '');
        byId('tab-mode').remove();
        const cycler = new RegionCycler(document, {});
        onTestFinished(cycler.start());
        byId('surface').focus();
        cycler.next();
        expect(document.activeElement).toBe(root.querySelector('footer'));
        cycler.next();
        expect(document.activeElement).toBe(byId('surface'));
    });
});

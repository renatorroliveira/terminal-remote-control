import type { ServerMessage, SessionInfo } from '@trc/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClientRequest } from '../connection/host-client';
import { THEMES } from '../ui/themes';
import type { SessionTransport } from './session-link';
import { TerminalRegistry } from './terminal-registry';

const info = (id: string): SessionInfo => ({
    id,
    order: 0,
    state: 'running',
    profile: {
        id: 'login',
        name: 'bash',
        origin: 'login',
        kind: 'bash',
        path: '/bin/bash',
        args: [],
        login: true,
        env: {},
        integration: 'off',
    },
    size: { cols: 120, rows: 40 },
});

class FakeTransport implements SessionTransport {
    readonly requests: ClientRequest[] = [];
    #stream = 0;

    request(_hostId: string, request: ClientRequest): Promise<ServerMessage> {
        this.requests.push(request);
        if (request.type === 'create') {
            return Promise.resolve({ type: 'created', requestId: 1, session: info('new') });
        }
        if (request.type === 'attach') {
            this.#stream += 1;
            return Promise.resolve({
                type: 'attached',
                requestId: 2,
                session: request.session,
                stream: this.#stream,
                credit: 1,
            });
        }
        return Promise.resolve({ type: 'done', requestId: 3 });
    }

    input(): void {
        return;
    }

    credit(): void {
        return;
    }

    onOutput(): () => void {
        return () => undefined;
    }
}

const registries: TerminalRegistry[] = [];

afterEach(() => {
    for (const registry of registries.splice(0)) {
        registry.dispose();
    }
    document.body.replaceChildren();
});

function setup() {
    const area = document.createElement('div');
    area.style.width = '1200px';
    area.style.height = '500px';
    area.style.position = 'relative';
    document.body.append(area);
    const transport = new FakeTransport();
    const registry = new TerminalRegistry({
        transport,
        isMac: true,
        assistiveTechnology: () => false,
        palette: THEMES.midnight.terminal,
        labelFor: (hostId, session) => ({
            name: `${session.profile.name}, ${hostId}`,
            hint: 'Option F1: accessibility help.',
        }),
    });
    registry.attach(area);
    registries.push(registry);
    return { area, transport, registry };
}

function requestsOf(transport: FakeTransport, type: ClientRequest['type']): number {
    return transport.requests.filter((request) => request.type === type).length;
}

function visibleSurfaces(area: HTMLElement): string[] {
    return [...area.querySelectorAll<HTMLElement>('[role="textbox"]')]
        .filter((surface) => surface.closest('[hidden]') === null)
        .map((surface) => surface.getAttribute('aria-label') ?? '');
}

describe('TerminalRegistry (US-1.8)', () => {
    it('shows one session at a time, keeps the others alive, and focuses the one it shows', async () => {
        const { area, transport, registry } = setup();
        registry.show('h1/a', 'h1', info('a'));
        registry.show('h1/b', 'h1', info('b'));
        expect(visibleSurfaces(area)).toEqual(['bash, h1']);
        expect(area.querySelectorAll('[role="textbox"]')).toHaveLength(2);
        const first = area.querySelectorAll('[role="textbox"]')[0];
        registry.show('h1/a', 'h1', info('a'));
        expect(area.querySelectorAll('[role="textbox"]')[0]).toBe(first);
        expect(document.activeElement).toBe(first);
        await expect.poll(() => requestsOf(transport, 'attach')).toBe(2);
    });

    it('creates a session at the terminal area size', async () => {
        const { transport, registry } = setup();
        const created = await registry.create('h1');
        expect(created.id).toBe('new');
        const create = transport.requests.find((request) => request.type === 'create');
        expect(create?.type === 'create' && create.spec.size.cols).toBe(120);
    });

    it('keeps a hidden terminal at its size instead of shrinking it to nothing', async () => {
        const { area, transport, registry } = setup();
        registry.show('h1/a', 'h1', info('a'));
        await expect.poll(() => requestsOf(transport, 'resize')).toBeGreaterThan(0);
        registry.show('h1/b', 'h1', info('b'));
        await new Promise((resolve) => setTimeout(resolve, 100));
        const resizes = transport.requests.flatMap((request) => (request.type === 'resize' ? [request.size.cols] : []));
        expect(Math.min(...resizes)).toBeGreaterThan(100);
        expect(area.querySelectorAll('[role="textbox"]')).toHaveLength(2);
    });
});

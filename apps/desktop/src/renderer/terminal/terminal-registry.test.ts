import type { ServerMessage, SessionInfo } from '@trc/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClientRequest } from '../connection/host-client';
import { THEMES } from '../ui/themes';
import type { SessionTransport } from './session-link';
import { type SessionSpeech, TerminalRegistry } from './terminal-registry';

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
    /** Sessions whose next attach the daemon refuses. */
    readonly refuse = new Set<string>();
    /** While set, attach replies wait for it. */
    hold: Promise<void> | undefined;
    /** While set, create replies wait for it. */
    holdCreate: Promise<void> | undefined;
    readonly #outputs = new Map<number, (data: Uint8Array) => void>();
    readonly #refusedListeners = new Set<(hostId: string) => void>();
    /** Input sent on each stream. */
    readonly inputs: string[] = [];
    #stream = 0;

    /** Says the connection refused input for a host, as the connection host does once it is gone. */
    refuseInputs(hostId: string): void {
        for (const listener of this.#refusedListeners) {
            listener(hostId);
        }
    }

    onInputRefused(listener: (hostId: string) => void): () => void {
        this.#refusedListeners.add(listener);
        return () => this.#refusedListeners.delete(listener);
    }

    /** Sends output on the stream the session attached with. */
    output(stream: number, text: string): void {
        this.#outputs.get(stream)?.(new TextEncoder().encode(text));
    }

    /** Whether a stream is attached. */
    attached(stream: number): boolean {
        return this.#outputs.has(stream);
    }

    request(_hostId: string, request: ClientRequest): Promise<ServerMessage> {
        this.requests.push(request);
        if (request.type === 'create') {
            const created: ServerMessage = { type: 'created', requestId: 1, session: info('new') };
            return (this.holdCreate ?? Promise.resolve()).then(() => created);
        }
        if (request.type === 'attach' && this.refuse.has(request.session)) {
            return Promise.reject(new Error('unknownSession'));
        }
        if (request.type === 'attach' && this.hold !== undefined) {
            const hold = this.hold;
            return hold.then(() => this.request(_hostId, { ...request }));
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

    input(_hostId: string, stream: number, text: string): void {
        this.inputs.push(`${stream}:${text}`);
    }

    credit(): void {
        return;
    }

    onOutput(_hostId: string, stream: number, listener: (data: Uint8Array) => void): () => void {
        this.#outputs.set(stream, listener);
        return () => this.#outputs.delete(stream);
    }
}

const registries: TerminalRegistry[] = [];

afterEach(() => {
    for (const registry of registries.splice(0)) {
        registry.dispose();
    }
    document.body.replaceChildren();
});

class FakeSpeech implements SessionSpeech {
    readonly spoken: string[] = [];
    readonly cancelled: string[] = [];
    readonly muted = new Set<string>();

    allowed(key: string): boolean {
        return !this.muted.has(key);
    }

    speak(key: string, text: string): void {
        this.spoken.push(`${key}: ${text}`);
    }

    cancel(key: string): void {
        this.cancelled.push(key);
    }

    floodThreshold(): number {
        return 20;
    }

    summary(lines: number): string {
        return `${lines} lines of output`;
    }
}

function setup() {
    const speech = new FakeSpeech();
    const notices: string[] = [];
    const failed: string[] = [];
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
            outputBelow: 'New output below',
            review: `Review ${session.profile.name}, ${hostId}`,
            disconnected: `${session.profile.name}, ${hostId}, disconnected`,
            inputRefused: 'Disconnected — input not sent',
        }),
        speech,
        onNotice: (key, notice) => notices.push(`${key} ${notice.kind}`),
        onAttachFailed: (key) => failed.push(key),
    });
    registry.attach(area);
    registries.push(registry);
    return { area, transport, registry, speech, notices, failed };
}

/** Waits two animation frames, after which pending work has run. */
function frames(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/** Types text into the visible terminal, as the keyboard does. */
function typeInto(area: HTMLElement, text: string): void {
    const surface = [...area.querySelectorAll<HTMLElement>('[role="textbox"]')].find(
        (candidate) => candidate.closest('[hidden]') === null,
    );
    surface?.dispatchEvent(
        new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }),
    );
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

    it('creates sessions with the scrollback set, and drops every terminal’s hint when hints are off', async () => {
        const { area, transport, registry } = setup();
        registry.setScrollback(50_000);
        await registry.create('h1');
        const create = transport.requests.find((request) => request.type === 'create');
        expect(create?.type === 'create' && create.spec.scrollbackLines).toBe(50_000);
        registry.show('h1/a', 'h1', info('a'));
        registry.setHints(false);
        registry.show('h1/b', 'h1', info('b'));
        expect(
            [...area.querySelectorAll('[role="textbox"]')].map((surface) => surface.hasAttribute('aria-describedby')),
        ).toEqual([false, false, false]);
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

/** A create the test releases by hand. */
function heldCreate(transport: FakeTransport): () => void {
    let release = (): void => undefined;
    transport.holdCreate = new Promise((resolve) => {
        release = resolve;
    });
    return release;
}

describe('TerminalRegistry: creating sessions (US-1.7.1, A11Y-01.1)', () => {
    it('keeps a new terminal hidden until it is shown, so it never covers the open one unnamed', async () => {
        const { area, registry, transport } = setup();
        registry.show('h1/a', 'h1', info('a'));
        const release = heldCreate(transport);
        const created = registry.create('h1');
        await expect.poll(() => requestsOf(transport, 'create')).toBe(1);
        expect(visibleSurfaces(area)).toEqual(['bash, h1']);
        release();
        await created;
        expect(visibleSurfaces(area)).toEqual(['bash, h1']);
        registry.show('h1/new', 'h1', info('new'));
        expect(area.querySelectorAll('[role="textbox"]')).toHaveLength(2);
        expect(visibleSurfaces(area)).toHaveLength(1);
    });

    it('opens a session announced while its create is in flight with the created terminal, not a second one', async () => {
        const { area, registry, transport } = setup();
        const release = heldCreate(transport);
        const created = registry.create('h1');
        await expect.poll(() => requestsOf(transport, 'create')).toBe(1);
        registry.show('h1/new', 'h1', info('new'));
        release();
        await created;
        await expect.poll(() => visibleSurfaces(area)).toEqual(['bash, h1']);
        expect(area.querySelectorAll('[role="textbox"]')).toHaveLength(1);
        expect(requestsOf(transport, 'attach')).toBe(1);
    });
});

describe('TerminalRegistry: input that cannot be sent (US-1.14.2, WCAG 3.3.1)', () => {
    it('says typing before a new terminal has attached was not sent, and reports a first attach that fails', async () => {
        const { area, transport, registry, notices, failed } = setup();
        let release = (): void => undefined;
        transport.hold = new Promise((done) => {
            release = done;
        });
        registry.show('h1/a', 'h1', info('a'));
        await expect.poll(() => requestsOf(transport, 'attach')).toBe(1);
        typeInto(area, 'ls');
        expect(transport.inputs).toEqual([]);
        expect(notices).toEqual(['h1/a input-refused']);
        transport.hold = undefined;
        release();
        transport.refuse.add('b');
        registry.show('h1/b', 'h1', info('b'));
        await expect.poll(() => failed).toEqual(['h1/b']);
        expect(area.querySelectorAll('[role="textbox"]')).toHaveLength(1);
    });

    it('says so on the open terminal when the connection refuses its host’s input', async () => {
        const { transport, registry, notices } = setup();
        registry.show('h1/a', 'h1', info('a'));
        registry.show('h2/b', 'h2', info('b'));
        await expect.poll(() => requestsOf(transport, 'attach')).toBe(2);
        transport.refuseInputs('h1');
        transport.refuseInputs('h2');
        expect(notices).toEqual(['h2/b input-refused']);
    });

    it('shows the latest session asked for when an earlier show waited for a create', async () => {
        const { area, registry, transport } = setup();
        const release = heldCreate(transport);
        const created = registry.create('h1');
        await expect.poll(() => requestsOf(transport, 'create')).toBe(1);
        registry.show('h1/x', 'h1', info('x'));
        release();
        await created;
        registry.show('h1/new', 'h1', info('new'));
        await frames();
        expect(area.querySelectorAll('[role="textbox"]')).toHaveLength(1);
    });
});

describe('TerminalRegistry: closing and losing hosts (US-1.8, US-1.14)', () => {
    it('removes the terminals of a host whose connection closed, and only those', () => {
        const { area, registry } = setup();
        registry.show('h1/a', 'h1', info('a'));
        registry.show('h2/b', 'h2', info('b'));
        registry.closeHost('h1');
        expect(
            [...area.querySelectorAll('[role="textbox"]')].map((surface) => surface.getAttribute('aria-label')),
        ).toEqual(['bash, h2']);
    });

    it('marks a lost host’s terminals disconnected, new ones too, and re-attaches them to a fresh screen (US-1.14)', async () => {
        const { area, transport, registry } = setup();
        registry.show('h1/a', 'h1', info('a'));
        registry.show('h2/b', 'h2', info('b'));
        await expect.poll(() => transport.attached(1) && transport.attached(2)).toBe(true);
        transport.output(1, 'old screen');
        registry.setHostConnected('h1', false);
        registry.show('h1/c', 'h1', info('c'));
        await expect.poll(() => requestsOf(transport, 'attach')).toBe(3);
        expect(
            [...area.querySelectorAll('[role="textbox"]')].map((surface) => surface.getAttribute('aria-label')),
        ).toEqual(['bash, h1, disconnected', 'bash, h2', 'bash, h1, disconnected']);
        await registry.reattachHost('h1');
        await expect.poll(() => requestsOf(transport, 'attach')).toBe(5);
        expect(transport.attached(1)).toBe(false);
        expect(transport.attached(2)).toBe(true);
        transport.output(4, 'restored');
        const first = area.querySelector<HTMLElement>('[role="textbox"]');
        await expect.poll(() => first?.textContent).toContain('restored');
        expect(first?.textContent).not.toContain('old screen');
        expect(first?.getAttribute('aria-label')).toBe('bash, h1');
    });
});

describe('TerminalRegistry: reconnecting hosts (US-1.14.2)', () => {
    it('refuses typing until a reconnected terminal has attached, and reports one that cannot attach (US-1.14.2)', async () => {
        const { area, transport, registry } = setup();
        registry.show('h1/a', 'h1', info('a'));
        registry.show('h1/b', 'h1', info('b'));
        await expect.poll(() => requestsOf(transport, 'attach')).toBe(2);
        registry.setHostConnected('h1', false);
        let release = (): void => undefined;
        transport.hold = new Promise((done) => {
            release = done;
        });
        transport.refuse.add('b');
        const reattached = registry.reattachHost('h1');
        const labels = (): (string | null)[] =>
            [...area.querySelectorAll('[role="textbox"]')].map((surface) => surface.getAttribute('aria-label'));
        await expect.poll(() => requestsOf(transport, 'attach')).toBe(4);
        expect(labels()).toEqual(['bash, h1, disconnected']);
        transport.hold = undefined;
        release();
        expect(await reattached).toEqual([{ key: 'h1/b', error: new Error('unknownSession') }]);
        expect(labels()).toEqual(['bash, h1']);
    });

    it('removes the terminal of a session the daemon closed', () => {
        const { area, registry } = setup();
        registry.show('h1/a', 'h1', info('a'));
        registry.show('h1/b', 'h1', info('b'));
        registry.closeSession('h1/a');
        expect(area.querySelectorAll('[role="textbox"]')).toHaveLength(1);
    });
});

describe('TerminalRegistry controls (A11Y-05.3, A11Y-05.4)', () => {
    it('focuses the open terminal, applies Tab focus mode to every terminal, and arms send-next-key', async () => {
        const { area, registry } = setup();
        expect(registry.focusOpen()).toBe(false);
        expect(registry.sendNextKey()).toBe(false);
        registry.show('h1/a', 'h1', info('a'));
        registry.setTabFocusMode(true);
        registry.show('h1/b', 'h1', info('b'));
        (document.activeElement as HTMLElement | null)?.blur();
        expect(registry.focusOpen()).toBe(true);
        const open = area.querySelectorAll<HTMLElement>('[role="textbox"]')[1];
        expect(document.activeElement).toBe(open);
        open?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
        expect(registry.passingNextKey()).toBe(false);
        expect(registry.sendNextKey()).toBe(true);
        expect(registry.passingNextKey()).toBe(true);
        open?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F6', code: 'F6', bubbles: true, cancelable: true }));
        expect(registry.passingNextKey()).toBe(false);
    });

    it('keeps the open terminal focused when the same area is attached again', () => {
        const { area, registry } = setup();
        registry.show('h1/a', 'h1', info('a'));
        const surface = area.querySelector<HTMLElement>('[role="textbox"]');
        expect(document.activeElement).toBe(surface);
        registry.attach(area);
        expect(document.activeElement).toBe(surface);
    });
});

describe('TerminalRegistry output speech (A11Y-02.1, A11Y-02.4, A11Y-02.7)', () => {
    const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 300));

    it('speaks the open session’s new output, and not the screen it restores on attach', async () => {
        const { transport, registry, speech } = setup();
        registry.show('h1/a', 'h1', info('a'));
        await expect.poll(() => transport.attached(1)).toBe(true);
        transport.output(1, 'restored\r\n$ ');
        await settled();
        transport.output(1, 'hello\r\n$ ');
        await expect.poll(() => speech.spoken).toEqual(['h1/a: hello\n$']);
    });

    it('stays silent for background and muted sessions, and drops what the session left behind had waiting', async () => {
        const { transport, registry, speech } = setup();
        registry.show('h1/a', 'h1', info('a'));
        registry.show('h1/b', 'h1', info('b'));
        await expect.poll(() => transport.attached(2)).toBe(true);
        expect(speech.cancelled).toEqual(['h1/a']);
        for (const stream of [1, 2]) {
            transport.output(stream, 'restored\r\n');
        }
        await settled();
        speech.muted.add('h1/b');
        transport.output(1, 'in the background\r\n');
        transport.output(2, 'muted\r\n');
        await settled();
        expect(speech.spoken).toEqual([]);
    });
});

function targets(registry: TerminalRegistry): string[] {
    return registry.visibleLinks().map((link) => link.target);
}

describe('TerminalRegistry links (US-1.12.3)', () => {
    it('lists the links on the open terminal’s screen, and none without an open session', async () => {
        const { transport, registry } = setup();
        expect(registry.visibleLinks()).toEqual([]);
        registry.show('h1/a', 'h1', info('a'));
        await expect.poll(() => transport.attached(1)).toBe(true);
        transport.output(1, 'see https://example.com/docs\r\n');
        await expect.poll(() => targets(registry)).toEqual(['https://example.com/docs']);
    });
});

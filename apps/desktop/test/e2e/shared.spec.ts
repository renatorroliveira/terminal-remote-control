import { expect, type Locator, type Page, test } from '@playwright/test';
import { connectLive, type LiveHost } from '../nfr/live-host';
import {
    E2E_HOST,
    launchWithTestHosts,
    openTerminal,
    recordSpeech,
    removeInstall,
    rowTexts,
    scratchInstallRoot,
    spokenTexts,
    testHostsMissing,
} from './support/test-host';

const missing = testHostsMissing();

async function spokenWith(window: Page, part: string): Promise<readonly string[]> {
    return (await spokenTexts(window)).filter((text) => text.includes(part));
}

async function screenText(terminal: Locator): Promise<string> {
    return (await rowTexts(terminal)).join('\n');
}

/** Attaches a second client, driven by the test over its own ssh connection, to the host's only session. */
async function secondClient(root: string): Promise<SecondClient> {
    const host = await connectLive(E2E_HOST, { root: root.replace(/^~\//, '') });
    const { message } = await host.request({ type: 'listSessions', requestId: 1 }, 'sessions');
    const session = message.sessions[0]?.id ?? '';
    const attached = await host.request({ type: 'attach', requestId: 2, session, mode: 'full' }, 'attached');
    return { host, session, stream: attached.message.stream };
}

interface SecondClient {
    readonly host: LiveHost;
    readonly session: string;
    readonly stream: number;
}

test.describe('a session shared with another client (US-2.6)', () => {
    const install = { root: '' };
    test.skip(missing !== undefined, missing);
    test.beforeEach(() => {
        install.root = scratchInstallRoot();
    });
    test.afterEach(() => {
        removeInstall(E2E_HOST, install.root);
    });

    test('shows the size another client set, announces its typing, and takes the size back on input', async () => {
        const { app, window } = await launchWithTestHosts(install.root);
        const terminal = await openTerminal(window, E2E_HOST);
        await expect.poll(() => screenText(terminal), { timeout: 30_000 }).toMatch(/[$#%] *$/m);
        const columns = await terminal.getAttribute('data-columns');
        await recordSpeech(window);
        const { host, session, stream } = await secondClient(install.root);
        await host.request({ type: 'resize', requestId: 3, session, size: { cols: 50, rows: 12 } }, 'done');
        await expect(terminal).toHaveAttribute('data-columns', '50', { timeout: 15_000 });
        await expect(window.getByText('Size set by another client', { exact: true })).toBeVisible();
        host.connection.input(stream, new TextEncoder().encode('echo from-peer\r'));
        await expect.poll(() => rowTexts(terminal), { timeout: 15_000 }).toContain('from-peer');
        await expect.poll(() => spokenWith(window, 'Input from another client')).toHaveLength(1);
        await terminal.focus();
        await window.keyboard.type('echo mine');
        await expect(terminal).toHaveAttribute('data-columns', columns ?? '', { timeout: 15_000 });
        await expect(window.getByText('Size set by another client', { exact: true })).toBeHidden();
        host.connection.close();
        await app.close();
    });
});

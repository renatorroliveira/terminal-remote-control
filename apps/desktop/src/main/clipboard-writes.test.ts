import { describe, expect, it } from 'vitest';
import type { KnownHost } from '../shared/hosts';
import { writeHostClipboard } from './clipboard-writes';

const host = (id: string, allowClipboardWrites?: boolean): KnownHost => ({
    id,
    address: { destination: `${id}.example` },
    installRoot: '~/.trc',
    ...(allowClipboardWrites === undefined ? {} : { allowClipboardWrites }),
});

describe('writeHostClipboard (SEC-06.1)', () => {
    it('writes the clipboard only for a host whose OSC 52 writes the user allowed, where hosts.json keeps that', async () => {
        const written: string[] = [];
        const deps = {
            hosts: () => Promise.resolve([host('allowed', true), host('default')]),
            writeText: (text: string) => written.push(text),
        };
        await expect(writeHostClipboard(deps, 'allowed', 'one')).resolves.toBe(true);
        await expect(writeHostClipboard(deps, 'default', 'two')).resolves.toBe(false);
        await expect(writeHostClipboard(deps, 'unknown', 'three')).resolves.toBe(false);
        expect(written).toEqual(['one']);
    });
});

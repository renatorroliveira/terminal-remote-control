import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAppLogger, Sensitive } from './app-log';

describe('createAppLogger (SEC-08)', () => {
    it('writes JSON lines to a 0600 file in a 0700 directory', () => {
        const dir = join(mkdtempSync(join(tmpdir(), 'trc-log-')), 'logs');
        const log = createAppLogger(dir, () => new Date('2026-11-12T10:00:00Z'));
        log.info('connecting', { hostId: 'h1', step: 'checking' });
        log.warn('failed', { kind: 'dns' });
        const file = join(dir, 'connection-host.log');
        const lines = readFileSync(file, 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        expect(lines).toEqual([
            { time: '2026-11-12T10:00:00.000Z', level: 'info', event: 'connecting', hostId: 'h1', step: 'checking' },
            { time: '2026-11-12T10:00:00.000Z', level: 'warn', event: 'failed', kind: 'dns' },
        ]);
        expect(statSync(file).mode & 0o777).toBe(0o600);
        expect(statSync(dir).mode & 0o777).toBe(0o700);
    });

    it('redacts sensitive values', () => {
        const dir = mkdtempSync(join(tmpdir(), 'trc-log-'));
        const log = createAppLogger(dir);
        log.info('input', { data: new Sensitive('hunter2') });
        expect(readFileSync(join(dir, 'connection-host.log'), 'utf8')).not.toContain('hunter2');
        expect(String(new Sensitive('x'))).toBe('[redacted]');
    });
});

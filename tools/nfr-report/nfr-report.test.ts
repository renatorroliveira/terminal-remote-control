import { describe, expect, it } from 'vitest';
import { measurementTable } from './nfr-report.ts';

describe('measurementTable', () => {
    it('lists each measurement with its value rounded for reading and its target', () => {
        expect(
            measurementTable([
                { id: 'NFR-02', what: 'echo, p95', value: 5.6512, unit: 'ms', target: '≤ 10.8 ms' },
                { id: 'NFR-09', what: 'a | b', value: 1234.5, unit: 'MiB', target: '—' },
            ]),
        ).toBe(
            [
                '| ID | Measurement | Value | Target |',
                '| --- | --- | --- | --- |',
                '| NFR-02 | echo, p95 | 5.7 ms | ≤ 10.8 ms |',
                '| NFR-09 | a \\| b | 1,235 MiB | — |',
            ].join('\n'),
        );
    });
});

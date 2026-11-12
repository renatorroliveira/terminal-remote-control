import { describe, expect, it } from 'vitest';
import { collectDefinitions, findUndefinedReferences } from './check-doc-ids.ts';

const PRD = `#### A11Y-04 — Selected text
1. first
2. second

#### US-1.4 — Install
1. one
2. two
3. three

| NFR-02 | Input latency |
| NFR-03 | Throughput |
| R1  | risk |

### 9.1 E1 — Accessible remote terminal
`;
const PLAN = `| P-01 | decision |
**ST-3 Protocol v1**
| S3  | E1 | spike |
`;

describe('collectDefinitions', () => {
    it('collects heading, table and story definitions with their numbered items', () => {
        const definitions = collectDefinitions([PRD, PLAN]);

        expect(definitions.get('A11Y-04')?.itemCount).toBe(2);
        expect(definitions.get('US-1.4')?.itemCount).toBe(3);
        expect([...definitions.keys()]).toEqual(
            expect.arrayContaining(['NFR-02', 'NFR-03', 'R1', 'E1', 'P-01', 'ST-3', 'S3']),
        );
    });
});

describe('findUndefinedReferences', () => {
    const definitions = collectDefinitions([PRD, PLAN]);
    const undefinedIn = (text: string): readonly string[] =>
        findUndefinedReferences('doc.md', text, definitions).map(({ reference }) => reference);

    it('accepts defined identifiers, numbered items, ranges, slash lists and spike parts', () => {
        expect(undefinedIn('A11Y-04.2 US-1.4.1–3 NFR-02/03 R1 E1 P-01 ST-3 S3a S3b')).toEqual([]);
    });

    it('reports unknown identifiers and missing numbered items with their line', () => {
        expect(undefinedIn('A11Y-09 US-1.4.4 NFR-02/04 R2 E9 P-02 ST-4 S4')).toEqual([
            'A11Y-09',
            'US-1.4.4',
            'NFR-02/04',
            'R2',
            'E9',
            'P-02',
            'ST-4',
            'S4',
        ]);
        expect(findUndefinedReferences('doc.md', 'ok\nR7', definitions)).toEqual([
            { file: 'doc.md', line: 2, reference: 'R7' },
        ]);
    });

    it('ignores identifiers that are part of a longer word', () => {
        expect(undefinedIn('E1-only and R1abc')).toEqual([]);
    });
});

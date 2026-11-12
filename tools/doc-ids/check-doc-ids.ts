import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** One requirement, decision or story identifier and the numbered items it holds. */
export interface Definition {
    readonly id: string;
    readonly itemCount: number;
}

/** A reference found in a document that names no definition. */
export interface UndefinedReference {
    readonly file: string;
    readonly line: number;
    readonly reference: string;
}

/** The documents whose identifiers must all resolve. */
export const DEFAULT_DOCUMENTS: readonly string[] = [
    'docs/PRD.md',
    'docs/TECH_STACK.md',
    'docs/plans/epic-01-implementation-plan.md',
];

const HEADING_DEFINITION = /^#{2,4} (?:9\.\d+ )?((?:A11Y|SEC)-\d\d|US-\d\.\d+|E\d) /;
const TABLE_DEFINITION = /^\| ((?:NFR|OQ|D|P)-\d+|R\d+|S\d+) +\|/;
const STORY_DEFINITION = /^\*\*(ST-\d+) /;
const NUMBERED_ITEM = /^\d+\. /;
const REFERENCE =
    /\b((?:A11Y|SEC|NFR|OQ|D|P|ST)-\d+|US-\d\.\d+|R\d+|S\d+[ab]?|E\d)((?:\.\d+)?)((?:(?:\/|[–-])\d+)*)(?![\w.-]*[\w])/g;

/**
 * Collects every identifier defined in the given documents, with the number of
 * numbered items under each heading definition.
 */
export function collectDefinitions(documents: readonly string[]): ReadonlyMap<string, Definition> {
    const definitions = new Map<string, Definition>();
    for (const text of documents) {
        let current: MutableDefinition | undefined;
        for (const line of text.split('\n')) {
            current = readLine(line, current, definitions);
        }
    }
    return definitions;
}

/** Returns every reference in a document that resolves to no definition or to a missing numbered item. */
export function findUndefinedReferences(
    file: string,
    text: string,
    definitions: ReadonlyMap<string, Definition>,
): readonly UndefinedReference[] {
    const problems: UndefinedReference[] = [];
    text.split('\n').forEach((line, index) => {
        for (const match of line.matchAll(REFERENCE)) {
            const [reference, base = '', item = '', tail = ''] = match;
            if (!isResolved(base, item, tail, definitions)) {
                problems.push({ file, line: index + 1, reference });
            }
        }
    });
    return problems;
}

/** Checks the default documents relative to a repository root and returns the undefined references. */
export function checkRepository(root: string): readonly UndefinedReference[] {
    const texts = DEFAULT_DOCUMENTS.map((file) => ({ file, text: readFileSync(resolve(root, file), 'utf8') }));
    const definitions = collectDefinitions(texts.map(({ text }) => text));
    return texts.flatMap(({ file, text }) => findUndefinedReferences(file, text, definitions));
}

interface MutableDefinition {
    readonly id: string;
    itemCount: number;
}

function readLine(
    line: string,
    current: MutableDefinition | undefined,
    definitions: Map<string, Definition>,
): MutableDefinition | undefined {
    const id = matchDefinition(line);
    if (id !== undefined) {
        const definition: MutableDefinition = { id, itemCount: 0 };
        definitions.set(id, definition);
        return definition;
    }
    if (line.startsWith('#')) {
        return undefined;
    }
    if (current !== undefined && NUMBERED_ITEM.test(line)) {
        current.itemCount += 1;
    }
    return current;
}

function matchDefinition(line: string): string | undefined {
    return (HEADING_DEFINITION.exec(line) ?? TABLE_DEFINITION.exec(line) ?? STORY_DEFINITION.exec(line))?.[1];
}

function isResolved(base: string, item: string, tail: string, definitions: ReadonlyMap<string, Definition>): boolean {
    const definition = definitions.get(spikeParent(base));
    if (definition === undefined) {
        return false;
    }
    const numbers = tail.split(/[/–-]/).filter((part) => part !== '');
    if (item === '') {
        return numbers.every((number) => definitions.has(withNumber(base, number)));
    }
    const items = [Number(item.slice(1)), ...numbers.map(Number)];
    return items.every((value) => value >= 1 && value <= definition.itemCount);
}

function spikeParent(base: string): string {
    return /^S\d+[ab]$/.test(base) ? base.slice(0, -1) : base;
}

function withNumber(base: string, number: string): string {
    const prefix = base.replace(/\d+$/, '');
    return `${prefix}${number}`;
}

if (import.meta.main) {
    const problems = checkRepository(process.cwd());
    for (const { file, line, reference } of problems) {
        console.error(`${file}:${line}: undefined reference ${reference}`);
    }
    process.exitCode = problems.length === 0 ? 0 : 1;
}

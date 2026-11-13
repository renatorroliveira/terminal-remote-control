/**
 * Renders the Markdown subset `USER_GUIDE.md` uses as accessible HTML (A11Y-10.4, P-18): headings with GitHub's
 * ids, paragraphs, nested lists, fenced code, tables with column headers, and inline code, bold and links.
 */

/** How links render. */
export interface RenderOptions {
    /** Where relative links point: a file of the repository on its main branch. */
    readonly repositoryUrl: string;
}

/** How a whole page renders. */
export interface DocumentOptions extends RenderOptions {
    /** The stylesheet the page links to. */
    readonly stylesheet: string;
}

interface Context {
    readonly options: RenderOptions;
    readonly slugs: Map<string, number>;
}

interface Block {
    readonly html: string;
    readonly next: number;
}

type Reader = (lines: readonly string[], start: number, context: Context) => Block | undefined;

const FENCE = /^(\s*)```(\w*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const TABLE_SEPARATOR = /^\|[\s|:-]+\|$/;

/** The HTML of a Markdown fragment, one block per line group. */
export function renderMarkdown(markdown: string, options: RenderOptions): string {
    return renderBlocks(markdown.replaceAll('\r\n', '\n').split('\n'), { options, slugs: new Map() }).join('\n');
}

/** A whole page: its language, its title from the first heading, the stylesheet, and the content in `<main>`. */
export function renderDocument(markdown: string, options: DocumentOptions): string {
    const title = /^#\s+(.*)$/m.exec(markdown)?.[1] ?? '';
    return [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        `<title>${escapeHtml(plainText(title))}</title>`,
        `<link rel="stylesheet" href="${escapeHtml(options.stylesheet)}">`,
        '</head>',
        '<body>',
        '<main>',
        renderMarkdown(markdown, options),
        '</main>',
        '</body>',
        '</html>',
        '',
    ].join('\n');
}

const READERS: readonly Reader[] = [readFence, readHeading, readTable, readList, readParagraph];

function renderBlocks(lines: readonly string[], context: Context): string[] {
    const blocks: string[] = [];
    let index = 0;
    while (index < lines.length) {
        if ((lines[index] ?? '').trim() === '') {
            index += 1;
            continue;
        }
        const block = READERS.map((reader) => reader(lines, index, context)).find((found) => found !== undefined);
        blocks.push(block?.html ?? '');
        index = block?.next ?? index + 1;
    }
    return blocks;
}

function readFence(lines: readonly string[], start: number): Block | undefined {
    const open = FENCE.exec(lines[start] ?? '');
    if (open === null) {
        return undefined;
    }
    const indent = open[1]?.length ?? 0;
    const code: string[] = [];
    let index = start + 1;
    while (index < lines.length && !FENCE.test(lines[index] ?? '')) {
        code.push(dedent(lines[index] ?? '', indent));
        index += 1;
    }
    const language = open[2] === '' ? '' : ` class="language-${open[2]}"`;
    return { html: `<pre><code${language}>${escapeHtml(code.join('\n'))}</code></pre>`, next: index + 1 };
}

function readHeading(lines: readonly string[], start: number, context: Context): Block | undefined {
    const heading = HEADING.exec(lines[start] ?? '');
    if (heading === null) {
        return undefined;
    }
    const level = heading[1]?.length ?? 1;
    const text = heading[2] ?? '';
    const id = uniqueSlug(text, context.slugs);
    return { html: `<h${level} id="${id}">${inline(text, context.options)}</h${level}>`, next: start + 1 };
}

function readTable(lines: readonly string[], start: number, context: Context): Block | undefined {
    const header = lines[start] ?? '';
    if (!header.startsWith('|') || !TABLE_SEPARATOR.test((lines[start + 1] ?? '').trim())) {
        return undefined;
    }
    let index = start + 2;
    const rows: string[] = [];
    while (index < lines.length && (lines[index] ?? '').startsWith('|')) {
        rows.push(
            `<tr>${cells(lines[index] ?? '')
                .map((cell) => `<td>${inline(cell, context.options)}</td>`)
                .join('')}</tr>`,
        );
        index += 1;
    }
    const headers = cells(header).map((cell) => `<th scope="col">${inline(cell, context.options)}</th>`);
    const html = ['<table>', `<thead><tr>${headers.join('')}</tr></thead>`, '<tbody>', ...rows, '</tbody>', '</table>'];
    return { html: html.join('\n'), next: index };
}

function readList(lines: readonly string[], start: number, context: Context): Block | undefined {
    const first = LIST_ITEM.exec(lines[start] ?? '');
    if (first === null) {
        return undefined;
    }
    const base = first[1]?.length ?? 0;
    const ordered = /\d/.test(first[2] ?? '');
    const items: string[] = [];
    let index = start;
    while (isItem(lines[index], base, ordered)) {
        const item = listItem(lines, index, base);
        items.push(renderItem(item.body, context));
        index = item.next;
    }
    const tag = ordered ? 'ol' : 'ul';
    return { html: [`<${tag}>`, ...items, `</${tag}>`].join('\n'), next: index };
}

function readParagraph(lines: readonly string[], start: number, context: Context): Block {
    const text: string[] = [];
    let index = start;
    while (index < lines.length && (index === start || continuesParagraph(lines, index))) {
        text.push((lines[index] ?? '').trim());
        index += 1;
    }
    return { html: `<p>${inline(text.join(' '), context.options)}</p>`, next: index };
}

function continuesParagraph(lines: readonly string[], index: number): boolean {
    const line = lines[index] ?? '';
    if (line.trim() === '' || FENCE.test(line) || HEADING.test(line) || LIST_ITEM.test(line)) {
        return false;
    }
    return !(line.startsWith('|') && TABLE_SEPARATOR.test((lines[index + 1] ?? '').trim()));
}

function isItem(line: string | undefined, base: number, ordered: boolean): boolean {
    const item = LIST_ITEM.exec(line ?? '');
    return item !== null && (item[1]?.length ?? 0) === base && /\d/.test(item[2] ?? '') === ordered;
}

function listItem(lines: readonly string[], start: number, base: number): { body: string[]; next: number } {
    const item = LIST_ITEM.exec(lines[start] ?? '');
    const width = base + (item?.[2]?.length ?? 1) + 1;
    const body = [item?.[3] ?? ''];
    let index = start + 1;
    while (index < lines.length && belongsToItem(lines, index, base)) {
        body.push(dedent(lines[index] ?? '', width));
        index += 1;
    }
    while (body.at(-1)?.trim() === '') {
        body.pop();
    }
    return { body, next: index };
}

function belongsToItem(lines: readonly string[], index: number, base: number): boolean {
    const line = lines[index] ?? '';
    if (line.trim() === '') {
        const following = lines.slice(index + 1).find((next) => next.trim() !== '');
        return following !== undefined && indentOf(following) > base;
    }
    return indentOf(line) > base;
}

function renderItem(body: readonly string[], context: Context): string {
    const blocks = renderBlocks(body, context);
    const tight = !body.some((line) => line.trim() === '');
    const shown = tight ? blocks.map((block) => block.replace(/^<p>([\s\S]*)<\/p>$/, '$1')) : blocks;
    return `<li>${shown.join('\n')}</li>`;
}

function cells(row: string): string[] {
    return row
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => cell.trim());
}

function inline(text: string, options: RenderOptions): string {
    return text
        .split('`')
        .map((part, index) => (index % 2 === 1 ? `<code>${escapeHtml(part)}</code>` : prose(part, options)))
        .join('');
}

function prose(text: string, options: RenderOptions): string {
    return escapeHtml(text)
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, target: string) => {
            return `<a href="${linkTarget(target, options)}">${label}</a>`;
        })
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function linkTarget(target: string, options: RenderOptions): string {
    if (target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
        return target;
    }
    return `${options.repositoryUrl}/blob/main/${target}`;
}

function uniqueSlug(text: string, slugs: Map<string, number>): string {
    const slug = plainText(text)
        .toLowerCase()
        .replace(/[^a-z0-9 _-]/g, '')
        .replaceAll(' ', '-');
    const seen = slugs.get(slug) ?? 0;
    slugs.set(slug, seen + 1);
    return seen === 0 ? slug : `${slug}-${seen}`;
}

function plainText(text: string): string {
    return text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*]/g, '');
}

function dedent(line: string, width: number): string {
    return line.slice(Math.min(width, indentOf(line)));
}

function indentOf(line: string): number {
    return line.length - line.trimStart().length;
}

function escapeHtml(text: string): string {
    return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

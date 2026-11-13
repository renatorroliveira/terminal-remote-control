import { describe, expect, it } from 'vitest';
import { renderDocument, renderMarkdown } from './markdown';

const REPOSITORY = 'https://github.com/example/repo';

function html(markdown: string): string {
    return renderMarkdown(markdown, { repositoryUrl: REPOSITORY });
}

describe('renderMarkdown: the subset USER_GUIDE.md uses (A11Y-10.4)', () => {
    it('gives headings the ids GitHub gives them, and joins a paragraph’s lines', () => {
        expect(html("## What's not there yet\n\nOne\nline <host>.")).toBe(
            '<h2 id="whats-not-there-yet">What\'s not there yet</h2>\n<p>One line &lt;host&gt;.</p>',
        );
    });

    it('renders code, bold and links, pointing repository files at the repository', () => {
        expect(html('**Bold** `a<b>` [x](#x), [y](https://y.example/a?b=1&c=2) and [PRD](docs/PRD.md).')).toBe(
            '<p><strong>Bold</strong> <code>a&lt;b&gt;</code> <a href="#x">x</a>, ' +
                '<a href="https://y.example/a?b=1&amp;c=2">y</a> and ' +
                `<a href="${REPOSITORY}/blob/main/docs/PRD.md">PRD</a>.</p>`,
        );
    });

    it('nests lists, keeps continued lines in their item, and holds code blocks inside items', () => {
        const markdown = [
            '1. First',
            '   continued.',
            '2. Second:',
            '',
            '    ```sh',
            '    echo <hi>',
            '    ```',
            '',
            '- **A.** one',
            '    - nested',
        ].join('\n');
        expect(html(markdown)).toBe(
            [
                '<ol>',
                '<li>First continued.</li>',
                '<li><p>Second:</p>\n<pre><code class="language-sh">echo &lt;hi&gt;</code></pre></li>',
                '</ol>',
                '<ul>',
                '<li><strong>A.</strong> one\n<ul>\n<li>nested</li>\n</ul></li>',
                '</ul>',
            ].join('\n'),
        );
    });

    it('renders tables with column headers', () => {
        expect(html('| Action | Keys |\n| ------ | ---- |\n| Copy   | `Cmd-C` |')).toBe(
            [
                '<table>',
                '<thead><tr><th scope="col">Action</th><th scope="col">Keys</th></tr></thead>',
                '<tbody>',
                '<tr><td>Copy</td><td><code>Cmd-C</code></td></tr>',
                '</tbody>',
                '</table>',
            ].join('\n'),
        );
    });
});

describe('renderDocument: a whole accessible page', () => {
    it('names the page after its first heading, sets its language and wraps it in a main landmark', () => {
        const page = renderDocument('# A guide\n\nText.', { repositoryUrl: REPOSITORY, stylesheet: 'guide.css' });
        expect(page).toContain('<html lang="en">');
        expect(page).toContain('<title>A guide</title>');
        expect(page).toContain('<link rel="stylesheet" href="guide.css">');
        expect(page).toContain('<main>\n<h1 id="a-guide">A guide</h1>\n<p>Text.</p>\n</main>');
    });
});

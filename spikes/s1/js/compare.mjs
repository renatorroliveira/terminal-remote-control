import { readFileSync } from 'node:fs';
import xtermHeadless from '@xterm/headless';
import graphemes from '@xterm/addon-unicode-graphemes';

const { Terminal } = xtermHeadless;
const { UnicodeGraphemesAddon } = graphemes;

const [cols, rows] = [Number(process.argv[2]), Number(process.argv[3])];
const results = JSON.parse(readFileSync(0, 'utf8'));

function makeTerm() {
    const t = new Terminal({ cols, rows, allowProposedApi: true, scrollback: 10000 });
    t.loadAddon(new UnicodeGraphemesAddon());
    t.unicode.activeVersion = '15-graphemes';
    return t;
}
const write = (t, data) => new Promise((r) => t.write(data, r));

function snapshot(t) {
    const b = t.buffer.active;
    const view = [];
    const widths = [];
    for (let y = 0; y < rows; y++) {
        const line = b.getLine(b.viewportY + y);
        view.push(line ? line.translateToString(true) : '');
        const w = [];
        for (let x = 0; line && x < cols; x++) {
            const cell = line.getCell(x);
            w.push(cell ? cell.getWidth() : -1);
        }
        widths.push(w.join(''));
    }
    const all = [];
    for (let y = 0; y < b.length; y++) all.push(b.getLine(y).translateToString(true));
    while (all.length && all[all.length - 1] === '') all.pop();
    return { type: b.type, cursor: [b.cursorX, b.cursorY], view, widths, all };
}

let failures = 0;
for (const r of results) {
    const a = makeTerm();
    const b = makeTerm();
    await write(a, readFileSync(r.name));
    await write(b, Buffer.from(r.vt, 'hex'));
    const sa = snapshot(a);
    const sb = snapshot(b);
    const diffs = [];
    if (sa.type !== sb.type) diffs.push(`buffer type ${sa.type} vs replay ${sb.type}`);
    if (String(sa.cursor) !== String(sb.cursor)) diffs.push(`cursor xterm=${sa.cursor} replay=${sb.cursor}`);
    if (String(sa.cursor) !== String(r.cursor)) diffs.push(`cursor xterm=${sa.cursor} ghostty=${r.cursor}`);
    sa.view.forEach((line, y) => {
        if (line !== sb.view[y]) diffs.push(`row ${y} text\n      xterm : ${JSON.stringify(line)}\n      replay: ${JSON.stringify(sb.view[y])}`);
        if (sa.widths[y] !== sb.widths[y]) diffs.push(`row ${y} widths\n      xterm : ${sa.widths[y]}\n      replay: ${sb.widths[y]}`);
    });
    if (sa.type === 'normal' && sa.all.join('\n') !== sb.all.join('\n'))
        diffs.push(`full buffer differs: xterm ${sa.all.length} lines, replay ${sb.all.length} lines`);
    const name = r.name.split('/').pop();
    console.log(`${diffs.length ? 'DIFF' : 'OK  '} ${name} cursor=${r.cursor} screen=${r.activeScreen} scrollback=${r.scrollbackRows} vtBytes=${r.vt.length / 2} titles=${r.titleChanges} bells=${r.bells}`);
    if (r.replies) console.log(`     replies: ${JSON.stringify(Buffer.from(r.replies, 'hex').toString('latin1'))}`);
    for (const d of diffs) console.log(`     - ${d}`);
    failures += diffs.length ? 1 : 0;
}
console.log(`${results.length - failures}/${results.length} samples match`);

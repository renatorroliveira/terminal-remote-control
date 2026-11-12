'use strict';

const params = new URLSearchParams(location.search);
const variant = params.get('variant') || 'editcontext';
const cadenceParam = params.get('cadence') || 'auto';
const auto = params.get('auto') || '';
const selectionCap = Number(params.get('cap') || 5000);
if (params.get('at') === 'on') document.documentElement.dataset.at = 'on';
if (params.get('atscolor')) document.getElementById('ats').style.color = params.get('atscolor');
const floodHoldBytesPerSecond = params.get('hold') === 'off' ? Infinity : 256 * 1024;

const term = new Terminal({
    cols: 120,
    rows: 30,
    fontFamily: 'Menlo, monospace',
    fontSize: 14,
    allowProposedApi: true,
    convertEol: true,
    scrollback: 10000,
});
term.loadAddon(new UnicodeGraphemesAddon.UnicodeGraphemesAddon());
term.unicode.activeVersion = '15-graphemes';
term.open(document.getElementById('xterm'));
let renderer = 'dom';
try {
    term.loadAddon(new WebglAddon.WebglAddon());
    renderer = 'webgl';
} catch {
    renderer = 'dom';
}

const ats = document.getElementById('ats');
const status = document.getElementById('status');
const cell = term._core._renderService.dimensions.css.cell;
ats.style.lineHeight = `${cell.height}px`;
ats.setAttribute('role', 'textbox');
ats.setAttribute('aria-multiline', 'true');
ats.setAttribute('aria-label', 'spike, localhost');
ats.setAttribute('aria-description', 'Option F1: accessibility help. Control F6: leave terminal.');
ats.tabIndex = 0;

const stats = { atsUpdates: 0, frames: [], longTasks: [], bytes: 0, started: 0 };
const rowNodes = new Map();
let pendingBytes = 0;
let paused = false;
let recentBytes = 0;
let floodHoldUntil = 0;
let ownSelection = null;
let scheduled = false;
let pointerSelecting = false;

setupInput();
setupSelectionMirroring();
setupButtons();
setupMeasurements();
window.spike.onData(onData);
status.textContent = `variant=${variant} renderer=${renderer} cadence=${cadenceParam} cell=${cell.width.toFixed(2)}x${cell.height}`;
term.write('S2 ATS spike. Type to echo locally.\r\n$ ');
scheduleUpdate();
runAuto();

function onData(chunk) {
    const bytes = chunk.length;
    stats.bytes += bytes;
    recentBytes += bytes;
    pendingBytes += bytes;
    term.write(chunk, () => {
        pendingBytes -= bytes;
        if (paused && pendingBytes < 128 * 1024) {
            paused = false;
            window.spike.resume();
        }
    });
    if (!paused && pendingBytes > 512 * 1024) {
        paused = true;
        window.spike.pause();
    }
}

term.onWriteParsed(() => scheduleUpdate());
term.onScroll(() => scheduleUpdate());

function cadenceMs() {
    if (cadenceParam === 'auto') {
        return document.documentElement.dataset.at === 'on' ? 250 : 0;
    }
    return Number(cadenceParam);
}

function scheduleUpdate() {
    if (scheduled) return;
    scheduled = true;
    const delay = cadenceMs();
    const run = () => {
        scheduled = false;
        if (delay > 0 && performance.now() < floodHoldUntil) {
            scheduleUpdate();
            return;
        }
        updateAts();
    };
    if (delay === 0) requestAnimationFrame(run);
    else setTimeout(run, delay);
}

setInterval(() => {
    if (recentBytes > floodHoldBytesPerSecond / 4) floodHoldUntil = performance.now() + 500;
    recentBytes = 0;
}, 250);

function rowText(bufferRow, padTo) {
    const line = term.buffer.active.getLine(bufferRow);
    if (!line) return '';
    let text = line.translateToString(true);
    if (padTo !== undefined) {
        const offset = colToOffset(bufferRow, padTo);
        if (text.length < offset) text = text.padEnd(offset, ' ');
    }
    return text;
}

function rowsToRender() {
    const b = term.buffer.active;
    const rows = new Set();
    for (let y = 0; y < term.rows; y++) rows.add(b.viewportY + y);
    const pos = term.getSelectionPosition();
    if (pos) {
        const last = Math.min(pos.end.y, pos.start.y + selectionCap - 1);
        for (let y = pos.start.y; y <= last; y++) rows.add(y);
    }
    return rows;
}

function updateAts() {
    const b = term.buffer.active;
    const cursorRow = b.baseY + b.cursorY;
    const wanted = rowsToRender();
    for (const [row, node] of rowNodes) {
        if (!wanted.has(row)) {
            node.remove();
            rowNodes.delete(row);
        }
    }
    const ordered = [...wanted].sort((a, c) => a - c);
    let previous = null;
    for (const row of ordered) {
        let node = rowNodes.get(row);
        if (!node) {
            node = document.createElement('div');
            node.className = 'row';
            node.dataset.row = String(row);
            node.appendChild(document.createTextNode(''));
            rowNodes.set(row, node);
        }
        const text = rowText(row, row === cursorRow ? b.cursorX : undefined);
        if (node.firstChild.data !== text) replaceMinimal(node.firstChild, text);
        node.style.top = `${(row - b.viewportY) * cell.height}px`;
        const expected = previous ? previous.nextSibling : ats.firstChild;
        if (expected !== node) ats.insertBefore(node, expected);
        previous = node;
    }
    stats.atsUpdates += 1;
    syncDomSelection();
}

function replaceMinimal(textNode, next) {
    const previous = textNode.data;
    let start = 0;
    while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
    let end = 0;
    while (
        end < previous.length - start &&
        end < next.length - start &&
        previous[previous.length - 1 - end] === next[next.length - 1 - end]
    )
        end++;
    textNode.replaceData(start, previous.length - start - end, next.slice(start, next.length - end));
}

function colToOffset(bufferRow, col) {
    const line = term.buffer.active.getLine(bufferRow);
    if (!line) return 0;
    let offset = 0;
    for (let x = 0; x < Math.min(col, term.cols); x++) {
        const c = line.getCell(x);
        if (!c || c.getWidth() === 0) continue;
        offset += c.getChars().length || 1;
    }
    return offset;
}

function offsetToCol(bufferRow, offset) {
    const line = term.buffer.active.getLine(bufferRow);
    if (!line) return 0;
    let consumed = 0;
    for (let x = 0; x < term.cols; x++) {
        const c = line.getCell(x);
        if (!c || c.getWidth() === 0) continue;
        if (consumed >= offset) return x;
        consumed += c.getChars().length || 1;
    }
    return term.cols;
}

function domPoint(bufferRow, col) {
    const node = rowNodes.get(bufferRow);
    if (!node) return null;
    const text = node.firstChild;
    return [text, Math.min(colToOffset(bufferRow, col), text.data.length)];
}

function setDomSelection(anchor, focus) {
    const selection = getSelection();
    if (
        selection.anchorNode === anchor[0] &&
        selection.anchorOffset === anchor[1] &&
        selection.focusNode === focus[0] &&
        selection.focusOffset === focus[1]
    )
        return;
    ownSelection = `${anchor[1]}@${anchor[0].parentNode.dataset.row}:${focus[1]}@${focus[0].parentNode.dataset.row}`;
    selection.setBaseAndExtent(anchor[0], anchor[1], focus[0], focus[1]);
}

function syncDomSelection() {
    if (document.activeElement !== ats || pointerSelecting) return;
    const pos = term.getSelectionPosition();
    const b = term.buffer.active;
    if (pos) {
        const start = domPoint(pos.start.y, pos.start.x);
        const end = domPoint(Math.min(pos.end.y, pos.start.y + selectionCap - 1), pos.end.x);
        if (start && end) setDomSelection(start, end);
        return;
    }
    const current = getSelection();
    if (!current.isCollapsed && ats.contains(current.anchorNode)) return;
    const caret = domPoint(b.baseY + b.cursorY, b.cursorX);
    if (caret) setDomSelection(caret, caret);
}

function setupSelectionMirroring() {
    term.onSelectionChange(() => scheduleUpdate());
    document.addEventListener('selectionchange', () => {
        const selection = getSelection();
        if (!selection.anchorNode || !ats.contains(selection.anchorNode)) return;
        const key = `${selection.anchorOffset}@${selection.anchorNode.parentNode?.dataset?.row}:${selection.focusOffset}@${selection.focusNode.parentNode?.dataset?.row}`;
        if (key === ownSelection) return;
        ownSelection = null;
        if (selection.isCollapsed) {
            term.clearSelection();
            return;
        }
        const range = selection.getRangeAt(0);
        const startRow = Number(range.startContainer.parentNode.dataset.row);
        const endRow = Number(range.endContainer.parentNode.dataset.row);
        const startCol = offsetToCol(startRow, range.startOffset);
        const endCol = offsetToCol(endRow, range.endOffset);
        const length = (endRow - startRow) * term.cols + endCol - startCol;
        term.select(startCol, startRow, length);
    });
    ats.addEventListener('focus', () => scheduleUpdate());
    ats.addEventListener('pointerdown', (event) => {
        if (event.button === 0) pointerSelecting = true;
    });
    window.addEventListener('pointerup', () => {
        if (!pointerSelecting) return;
        pointerSelecting = false;
        scheduleUpdate();
    });
}

const keyMap = {
    Enter: '\r',
    Backspace: '\x7f',
    Tab: '\t',
    Escape: '\x1b',
    ArrowUp: '\x1b[A',
    ArrowDown: '\x1b[B',
    ArrowRight: '\x1b[C',
    ArrowLeft: '\x1b[D',
};

function send(text) {
    term.clearSelection();
    term.scrollToBottom();
    const selection = getSelection();
    if (!selection.isCollapsed && ats.contains(selection.anchorNode)) {
        const b = term.buffer.active;
        const caret = domPoint(b.baseY + b.cursorY, b.cursorX);
        if (caret) setDomSelection(caret, caret);
    }
    term.write(text.replace(/\r/g, '\r\n$ ').replace(/\x7f/g, '\b \b'));
}

function setupInput() {
    ats.addEventListener('keydown', (event) => {
        if (event.metaKey) return;
        if (event.key === 'F6' && event.ctrlKey) {
            event.preventDefault();
            document.getElementById('after').focus();
            return;
        }
        const mapped = keyMap[event.key];
        if (mapped && !event.isComposing) {
            event.preventDefault();
            send(mapped);
        } else if (event.ctrlKey && event.key.length === 1) {
            event.preventDefault();
            send(String.fromCharCode(event.key.toUpperCase().charCodeAt(0) - 64));
        }
    });
    if (variant === 'editcontext' && 'EditContext' in window) {
        const context = new EditContext();
        ats.editContext = context;
        context.addEventListener('textupdate', (event) => {
            send(event.text);
            context.updateText(0, context.text.length, '');
            context.updateSelection(0, 0);
        });
        context.addEventListener('characterboundsupdate', () => updateEditContextBounds(context));
        term.onCursorMove(() => updateEditContextBounds(context));
        updateEditContextBounds(context);
    } else if (variant === 'contenteditable') {
        ats.contentEditable = 'true';
        ats.addEventListener('beforeinput', (event) => {
            event.preventDefault();
            if (event.data && !event.isComposing) send(event.data);
        });
        ats.addEventListener('compositionend', (event) => send(event.data));
    } else {
        ats.setAttribute('aria-readonly', 'true');
        ats.addEventListener('keypress', (event) => send(event.key));
    }
}

function updateEditContextBounds(context) {
    const host = ats.getBoundingClientRect();
    const b = term.buffer.active;
    const x = host.left + b.cursorX * cell.width;
    const y = host.top + b.cursorY * cell.height;
    const caret = new DOMRect(x, y, cell.width, cell.height);
    context.updateControlBounds(host);
    context.updateSelectionBounds(caret);
}

function setupButtons() {
    const flood = (command) => {
        stats.started = performance.now();
        window.spike.flood(command);
    };
    document.getElementById('yes').onclick = () => flood('yes');
    document.getElementById('big').onclick = () => flood("yes 'The quick brown fox jumps over the lazy dog 0123456789 abcdefghijklmnopqrstuvwxyz' | head -c 1073741824");
    document.getElementById('find').onclick = () => flood('find / 2>/dev/null');
    document.getElementById('stop').onclick = () => window.spike.stop();
    document.getElementById('sample').onclick = () =>
        term.write('\r\nHello world. The quick brown fox jumps over the lazy dog.\r\nSecond line: 日本語 and émoji 👍🏽 done.\r\n$ ');
    document.getElementById('selectall').onclick = () => {
        term.selectAll();
        ats.focus();
    };
}

function setupMeasurements() {
    let last = performance.now();
    const frame = (now) => {
        stats.frames.push(now - last);
        last = now;
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) stats.longTasks.push(entry.duration);
    }).observe({ type: 'longtask', buffered: true });
}

function percentile(values, p) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, c) => a - c);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))];
}

function summary(seconds) {
    return {
        variant,
        renderer,
        cadence: cadenceParam,
        at: document.documentElement.dataset.at || 'off',
        seconds,
        megabytes: +(stats.bytes / 1048576).toFixed(1),
        mbPerSecond: +(stats.bytes / 1048576 / seconds).toFixed(1),
        frames: stats.frames.length,
        frameP50: +percentile(stats.frames, 50).toFixed(1),
        frameP95: +percentile(stats.frames, 95).toFixed(1),
        frameMax: +Math.max(0, ...stats.frames).toFixed(1),
        longTasks: stats.longTasks.length,
        longTaskMaxMs: +Math.max(0, ...stats.longTasks).toFixed(1),
        atsUpdates: stats.atsUpdates,
        atsUpdatesPerSecond: +(stats.atsUpdates / seconds).toFixed(1),
    };
}

function resetStats() {
    stats.atsUpdates = 0;
    stats.frames = [];
    stats.longTasks = [];
    stats.bytes = 0;
}

function runAuto() {
    if (!auto) return;
    const commands = {
        yes: 'yes',
        big: "yes 'The quick brown fox jumps over the lazy dog 0123456789 abcdefghijklmnopqrstuvwxyz' | head -c 1073741824",
        find: 'find / 2>/dev/null',
    };
    if (auto.startsWith('select')) {
        runSelectAuto();
        return;
    }
    setTimeout(() => {
        ats.focus();
        resetStats();
        window.spike.flood(commands[auto]);
        setTimeout(() => {
            window.spike.stop();
            window.spike.report(summary(8));
        }, 8000);
    }, 1000);
}

function runSelectAuto() {
    const lines = [];
    for (let i = 0; i < 10000; i++) lines.push(`line ${String(i).padStart(5, '0')} the quick brown fox jumps over the lazy dog`);
    term.write(lines.join('\r\n'), () => {
        ats.focus();
        resetStats();
        const t0 = performance.now();
        term.selectAll();
        updateAts();
        const elapsed = performance.now() - t0;
        setTimeout(() => {
            const selection = getSelection();
            window.spike.report({
                ...summary(2),
                selectAllMs: +elapsed.toFixed(1),
                cap: selectionCap,
                renderedRows: rowNodes.size,
                domSelectedChars: selection.toString().length,
                xtermSelectedChars: term.getSelection().length,
            });
        }, 2000);
    });
}

function runScenario(name) {
    const sample = '\r\nHello world. The quick brown fox jumps over the lazy dog.\r\nSecond line: 日本語 and émoji 👍🏽 done.\r\n$ ';
    if (name === 'selectall') {
        runSelectAuto();
        return;
    }
    term.write(sample, () => {
        ats.focus();
        updateAts();
        const b = term.buffer.active;
        const row = b.baseY + b.cursorY - 2;
        if (name === 'select' || name === 'selecttype') term.select(17, row, 15);
        if (name === 'selecttype' || name === 'type') setTimeout(() => window.spike.type('ab'), 500);
        if (name === 'domselect') {
            const node = rowNodes.get(row).firstChild;
            getSelection().setBaseAndExtent(node, 6, node, 11);
        }
        setTimeout(() => window.spike.report({ scenario: name, xtermSelection: term.getSelection(), domSelection: getSelection().toString() }), 1500);
    });
}
if (params.get('scenario')) setTimeout(() => runScenario(params.get('scenario')), 800);
if (params.get('desc') === 'describedby') {
    const hint = document.createElement('span');
    hint.id = 'ats-hint';
    hint.hidden = true;
    hint.textContent = 'Option F1: accessibility help. Control F6: leave terminal.';
    document.body.appendChild(hint);
    ats.removeAttribute('aria-description');
    ats.setAttribute('aria-describedby', 'ats-hint');
}

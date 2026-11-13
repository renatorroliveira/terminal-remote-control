/** The phosphor green of the app's borders. */
const GREEN = '#00ad2c';
/** The lit phosphor of the dot-matrix text. */
const PHOSPHOR = '#3dff6e';
const DOT_COLUMNS = 5;
const DOT_ROWS = 7;
const GLYPH_ADVANCE = 6;
const LINE_ADVANCE = 9;
const DOT_CHANCE = 0.42;
const GAP_CHANCE = 0.16;

interface Terminal {
    readonly cx: number;
    readonly cy: number;
    readonly rotation: number;
    readonly seed: number;
    readonly prompt: boolean;
}

const WIDTH = 330;
const HEIGHT = 250;
const TERMINALS: readonly Terminal[] = [
    { cx: 512, cy: 330, rotation: 0, seed: 5, prompt: true },
    { cx: 296, cy: 690, rotation: -6, seed: 8, prompt: false },
    { cx: 728, cy: 690, rotation: 6, seed: 13, prompt: false },
];
const LINKS = 'M512 360 L300 680 M512 360 L724 680 M300 680 L724 680';
const PROMPT_GLYPH = ['00100', '00010', '00001', '00010', '00100', '00000', '00000'] as const;

/**
 * The app logo on the 1024 px macOS icon grid: three VT-style terminals at the corners of a triangle, linked like
 * remote hosts, with dot-matrix phosphor text; the top one shows the prompt and a block cursor.
 */
export function logoSvg(): string {
    const defs = `<defs>${TILE_DEFS}${GLOW_DEFS}</defs>`;
    const links = `<g stroke="${GREEN}" stroke-width="16" stroke-linecap="round" filter="url(#glow)" opacity="0.9"><path d="${LINKS}"/></g>`;
    const body = links + TERMINALS.map((terminal) => detailedTerminal(terminal)).join('');
    return tile(defs, `<g filter="url(#shadow)">${TILE_SHAPE}</g>`, body);
}

/** The logo for 16 to 32 px: the same composition with thick outlines and cursors, and no text, glow or shadow. */
export function smallLogoSvg(): string {
    const links = `<path d="${LINKS}" stroke="${GREEN}" stroke-width="64" stroke-linecap="round"/>`;
    const body = links + TERMINALS.map((terminal) => plainTerminal(terminal)).join('');
    return tile(`<defs>${TILE_DEFS}</defs>`, TILE_SHAPE, body);
}

const TILE_SHAPE = '<rect x="100" y="100" width="824" height="824" rx="186" fill="url(#bg)"/>';
const TILE_DEFS = `<clipPath id="tile"><rect x="100" y="100" width="824" height="824" rx="186"/></clipPath>
<radialGradient id="bg" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#0c1a0f"/><stop offset="1" stop-color="#010301"/></radialGradient>
<radialGradient id="screen" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#06260e"/><stop offset="1" stop-color="#010a03"/></radialGradient>`;
const GLOW_DEFS = `<pattern id="scan" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="3" fill="#000" opacity="0.28"/></pattern>
<filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="14" stdDeviation="14" flood-opacity="0.45"/></filter>`;

function tile(defs: string, background: string, body: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img"><title>Terminal Remote Control</title>${defs}${background}<g clip-path="url(#tile)">${body}</g><rect x="102" y="102" width="820" height="820" rx="184" fill="none" stroke="${GREEN}" stroke-opacity="0.35" stroke-width="4"/></svg>\n`;
}

function detailedTerminal(terminal: Terminal): string {
    const screen = screenBox();
    const dot = Math.round(screen.width / 80);
    const columns = Math.floor((screen.width - dot * 4) / (dot * GLYPH_ADVANCE));
    const lines = Math.floor((screen.height - dot * 4) / (dot * LINE_ADVANCE));
    const text = dotMatrix({ x: screen.x + dot * 2, y: screen.y + dot * 2.5, columns, lines, dot }, terminal);
    const clipId = `screen-${terminal.seed}`;
    return `<g data-terminal="${terminal.seed}" transform="translate(${terminal.cx} ${terminal.cy}) rotate(${terminal.rotation})">
${bezel(6)}<rect ${boxAttributes(screen)} fill="url(#screen)"/>
<clipPath id="${clipId}"><rect ${boxAttributes(screen)}/></clipPath>
<g clip-path="url(#${clipId})"><path data-text="" d="${text}" fill="${PHOSPHOR}" filter="url(#glow)"/></g>
<rect ${boxAttributes(screen)} fill="url(#scan)"/></g>`;
}

function plainTerminal(terminal: Terminal): string {
    const screen = screenBox();
    const cursor = `<rect x="${screen.x + 40}" y="${screen.y + 40}" width="70" height="100" fill="${GREEN}"/>`;
    return `<g data-terminal="${terminal.seed}" transform="translate(${terminal.cx} ${terminal.cy}) rotate(${terminal.rotation})">${bezel(64)}<rect ${boxAttributes(screen)} fill="url(#screen)"/>${cursor}</g>`;
}

interface Box {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly radius: number;
}

function screenBox(): Box {
    const insetX = WIDTH * 0.08;
    const insetY = HEIGHT * 0.09;
    const height = HEIGHT - 2 * insetY;
    return { x: -WIDTH / 2 + insetX, y: -HEIGHT / 2 + insetY, width: WIDTH - 2 * insetX, height, radius: height * 0.1 };
}

function bezel(stroke: number): string {
    return `<rect x="${-WIDTH / 2}" y="${-HEIGHT / 2}" width="${WIDTH}" height="${HEIGHT}" rx="${HEIGHT * 0.13}" fill="#161d17" stroke="${GREEN}" stroke-width="${stroke}"/>`;
}

function boxAttributes(box: Box): string {
    return `x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="${box.radius}"`;
}

interface TextArea {
    readonly x: number;
    readonly y: number;
    readonly columns: number;
    readonly lines: number;
    readonly dot: number;
}

function dotMatrix(area: TextArea, terminal: Terminal): string {
    const random = seededRandom(terminal.seed);
    let path = '';
    for (let line = 0; line < area.lines; line++) {
        const top = area.y + line * area.dot * LINE_ADVANCE;
        path +=
            terminal.prompt && line === area.lines - 1
                ? promptLine(area.x, top, area.dot)
                : gibberishLine(area, top, random);
    }
    return path;
}

function gibberishLine(area: TextArea, top: number, random: () => number): string {
    const length = Math.max(3, Math.floor(area.columns * (0.45 + random() * 0.55)));
    let path = '';
    for (let column = 0; column < length; column++) {
        if (random() >= GAP_CHANCE) {
            path += glyph(area.x + column * area.dot * GLYPH_ADVANCE, top, area.dot, () => random() < DOT_CHANCE);
        }
    }
    return path;
}

function promptLine(left: number, top: number, dot: number): string {
    const chevron = glyph(left, top, dot, (column, row) => PROMPT_GLYPH[row]?.[column] === '1');
    const cursorLeft = left + dot * GLYPH_ADVANCE * 2;
    return `${chevron}M${cursorLeft} ${top}h${dot * DOT_COLUMNS}v${dot * DOT_ROWS}h${-dot * DOT_COLUMNS}z`;
}

function glyph(left: number, top: number, dot: number, lit: (column: number, row: number) => boolean): string {
    let path = '';
    for (let row = 0; row < DOT_ROWS; row++) {
        for (let column = 0; column < DOT_COLUMNS; column++) {
            path += lit(column, row) ? `M${left + column * dot} ${top + row * dot}h${dot}v${dot}h${-dot}z` : '';
        }
    }
    return path;
}

function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 2 ** 32;
    };
}

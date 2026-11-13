import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { packIco } from './ico.ts';
import { ICO_SIZES, ICONSET_ENTRIES, LINUX_SIZES, SMALL_LOGO_MAX_SIZE } from './icon-sizes.ts';
import { logoSvg, smallLogoSvg } from './logo.ts';

/** An image element, which can wait until it is decoded. */
interface Decodable {
    decode(): Promise<void>;
}

/** Where the icons go: the vector masters and the platform renders the packager and the app read. */
export const ICONS_DIRECTORY = resolve(import.meta.dirname, '../../apps/desktop/resources/icons');

/**
 * Draws the logo and renders every icon the desktop app ships: `icon.svg` and `icon-small.svg`, `icon.icns` (macOS,
 * through `iconutil`), `icon.ico` (Windows), `png/<size>x<size>.png` (Linux) and `icon.png` (window icon).
 */
export async function renderIcons(directory = ICONS_DIRECTORY): Promise<void> {
    mkdirSync(join(directory, 'png'), { recursive: true });
    writeFileSync(join(directory, 'icon.svg'), logoSvg());
    writeFileSync(join(directory, 'icon-small.svg'), smallLogoSvg());
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage();
        const sizes = [...new Set([...ICONSET_ENTRIES.map((entry) => entry.size), ...ICO_SIZES, ...LINUX_SIZES])];
        const pngs = new Map<number, Uint8Array>();
        for (const size of sizes.sort((left, right) => left - right)) {
            pngs.set(size, await renderPng(page, size));
        }
        writeOutputs(directory, pngs);
    } finally {
        await browser.close();
    }
}

async function renderPng(page: Page, size: number): Promise<Uint8Array> {
    const svg = size <= SMALL_LOGO_MAX_SIZE ? smallLogoSvg() : logoSvg();
    const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
        `<body style="margin:0;background:transparent"><img src="${source}" width="${size}" height="${size}"></body>`,
    );
    await page.locator('img').evaluate((image: Decodable) => image.decode());
    return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

function writeOutputs(directory: string, pngs: ReadonlyMap<number, Uint8Array>): void {
    const png = (size: number): Uint8Array => pngs.get(size) ?? new Uint8Array();
    for (const size of LINUX_SIZES) {
        writeFileSync(join(directory, 'png', `${size}x${size}.png`), png(size));
    }
    writeFileSync(join(directory, 'icon.png'), png(512));
    writeFileSync(join(directory, 'icon.ico'), packIco(ICO_SIZES.map((size) => ({ size, png: png(size) }))));
    writeIcns(directory, png);
}

function writeIcns(directory: string, png: (size: number) => Uint8Array): void {
    if (process.platform !== 'darwin') {
        console.warn('icon.icns not rebuilt: iconutil runs only on macOS');
        return;
    }
    const scratch = mkdtempSync(join(tmpdir(), 'trc-icons-'));
    const iconset = join(scratch, 'icon.iconset');
    mkdirSync(iconset);
    for (const entry of ICONSET_ENTRIES) {
        writeFileSync(join(iconset, entry.file), png(entry.size));
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(directory, 'icon.icns')]);
    rmSync(scratch, { recursive: true, force: true });
}

if (import.meta.main) {
    await renderIcons();
}

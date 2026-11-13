import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appIconPath } from './app-icon';

const resources = resolve(import.meta.dirname, '../../resources');

describe('appIconPath', () => {
    it('points at the 512 px PNG rendered from the logo, which the window and the dock show', () => {
        const path = appIconPath(resources);
        expect(path).toBe(join(resources, 'icons', 'icon.png'));
        expect(existsSync(path)).toBe(true);
        const png = readFileSync(path);
        expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([512, 512]);
    });
});

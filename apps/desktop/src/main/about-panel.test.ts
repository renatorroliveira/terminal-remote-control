import { describe, expect, it } from 'vitest';
import { aboutPanelOptions } from './about-panel';

describe('aboutPanelOptions: the About panel shows the product, its version and the commit it was built from', () => {
    it('names the product and its version, with the commit as the build, the copyright and the repository', () => {
        expect(aboutPanelOptions({ version: '0.2.0-dev', commit: '3c4d86c' })).toEqual({
            applicationName: 'Terminal Remote Control',
            applicationVersion: '0.2.0-dev',
            version: '3c4d86c',
            copyright: 'Copyright © 2026 Renato Oliveira',
            credits: 'https://github.com/renatorroliveira/terminal-remote-control',
        });
    });
});

import { describe, expect, it } from 'vitest';
import { wrongOsMessage } from './require-os.ts';

describe('wrongOsMessage', () => {
    it('lets the script run on its own OS', () => {
        expect(wrongOsMessage('test:ax:mac', 'darwin', 'darwin')).toBeUndefined();
    });

    it('names the script and both OSes elsewhere', () => {
        expect(wrongOsMessage('test:ax:mac', 'darwin', 'win32')).toBe(
            'test:ax:mac runs only on darwin; this is win32\n',
        );
    });
});

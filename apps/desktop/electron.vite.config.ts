import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

const LOOPBACK = '127.0.0.1';
const TEST_SEAM = { __TRC_TEST_SEAM__: JSON.stringify(process.env['TRC_TEST_BUILD'] === '1') };

export default defineConfig({
    main: {
        define: TEST_SEAM,
        build: {
            externalizeDeps: { exclude: ['@trc/protocol'] },
            rollupOptions: {
                input: { index: resolve(import.meta.dirname, 'src/main/index.ts') },
            },
        },
    },
    preload: {
        build: {
            externalizeDeps: false,
            rollupOptions: {
                input: { index: resolve(import.meta.dirname, 'src/preload/index.ts') },
                output: { format: 'cjs', entryFileNames: '[name].cjs' },
            },
        },
    },
    renderer: {
        root: resolve(import.meta.dirname, 'src/renderer'),
        define: TEST_SEAM,
        plugins: [react()],
        server: { host: LOOPBACK, strictPort: false },
        build: {
            rollupOptions: {
                input: { index: resolve(import.meta.dirname, 'src/renderer/index.html') },
            },
        },
    },
});

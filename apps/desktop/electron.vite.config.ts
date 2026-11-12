import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

const LOOPBACK = '127.0.0.1';

export default defineConfig({
    main: {
        build: {
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
        plugins: [react()],
        server: { host: LOOPBACK, strictPort: false },
        build: {
            rollupOptions: {
                input: { index: resolve(import.meta.dirname, 'src/renderer/index.html') },
            },
        },
    },
});

import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { buildCommit } from '../../tools/build-info/build-commit';

const LOOPBACK = '127.0.0.1';
const BUILD_INFO = { __TRC_BUILD_COMMIT__: JSON.stringify(buildCommit(resolve(import.meta.dirname, '../..'))) };

// `electron-vite build --mode test` is a test build with the P-14 seam compiled in; a mode, not an environment
// variable, so the script runs the same under cmd.exe on Windows.
export default defineConfig(({ mode }) => {
    const TEST_SEAM = { __TRC_TEST_SEAM__: JSON.stringify(mode === 'test') };
    return {
        main: {
            define: { ...TEST_SEAM, ...BUILD_INFO },
            build: {
                externalizeDeps: false,
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
    };
});

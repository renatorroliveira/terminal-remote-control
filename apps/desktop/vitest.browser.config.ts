import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [react()],
    define: { __TRC_TEST_SEAM__: 'false' },
    resolve: { dedupe: ['react', 'react-dom'] },
    optimizeDeps: {
        include: [
            'react',
            'react-dom',
            'react-dom/client',
            'react-intl',
            'react-aria-components',
            'vitest-browser-react',
        ],
    },
});

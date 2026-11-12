import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [react()],
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

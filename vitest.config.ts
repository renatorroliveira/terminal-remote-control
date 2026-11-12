import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        projects: [
            {
                test: {
                    name: 'node-unit',
                    environment: 'node',
                    include: [
                        'tools/**/*.test.ts',
                        'packages/*/test/**/*.test.ts',
                        'apps/desktop/src/{main,preload,connection-host,shared}/**/*.test.ts',
                    ],
                },
            },
            {
                extends: 'apps/desktop/vitest.browser.config.ts',
                test: {
                    name: 'browser',
                    include: ['apps/desktop/src/renderer/**/*.test.{ts,tsx}'],
                    browser: {
                        enabled: true,
                        headless: true,
                        provider: playwright(),
                        instances: [{ browser: 'chromium' }],
                        api: { host: '127.0.0.1' },
                    },
                },
            },
            {
                test: {
                    name: 'node-integration',
                    environment: 'node',
                    include: ['**/*.integration.test.ts'],
                    exclude: ['**/node_modules/**'],
                    testTimeout: 120_000,
                    fileParallelism: false,
                },
            },
            {
                test: {
                    name: 'ax',
                    environment: 'node',
                    include: ['**/*.ax.test.ts'],
                    exclude: ['**/node_modules/**'],
                    testTimeout: 120_000,
                    fileParallelism: false,
                },
            },
        ],
    },
});

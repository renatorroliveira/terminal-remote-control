import { defineConfig } from '@playwright/test';

/** The app half of `pnpm test:soak`: real app launches that quit or crash (NFR-11, P-25). */
export default defineConfig({
    testDir: 'test/soak',
    testMatch: '*.spec.ts',
    fullyParallel: false,
    workers: 1,
    timeout: 3 * 60 * 60 * 1_000,
    reporter: [['list']],
});

import { defineConfig } from '@playwright/test';

/** The UI half of `pnpm test:nfr`: timing against the live test hosts (ST-19). */
export default defineConfig({
    testDir: 'test/nfr',
    testMatch: '*.spec.ts',
    fullyParallel: false,
    workers: 1,
    timeout: 240_000,
    reporter: [['list']],
});

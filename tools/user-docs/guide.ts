/**
 * Renders `USER_GUIDE.md` to the in-app user guide, `apps/desktop/resources/docs/index.html` (A11Y-10.4, P-18),
 * which the Help menu opens. Run it with `pnpm docs:guide` after changing the guide; a test fails while the
 * committed page is stale.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_IDENTITY } from '../../apps/desktop/src/shared/app-identity.ts';
import { renderDocument } from './markdown.ts';

const REPOSITORY = resolve(import.meta.dirname, '../..');

/** Where the guide comes from and where its page goes. */
export const GUIDE_PATHS = {
    source: resolve(REPOSITORY, 'USER_GUIDE.md'),
    output: resolve(REPOSITORY, 'apps/desktop/resources/docs/index.html'),
} as const;

/** The guide's page, from the current `USER_GUIDE.md`. */
export function renderGuide(): string {
    return renderDocument(readFileSync(GUIDE_PATHS.source, 'utf8'), {
        repositoryUrl: APP_IDENTITY.repositoryUrl,
        stylesheet: 'guide.css',
    });
}

if (import.meta.main) {
    writeFileSync(GUIDE_PATHS.output, renderGuide());
}

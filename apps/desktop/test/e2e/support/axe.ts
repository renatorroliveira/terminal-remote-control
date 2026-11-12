import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/** The WCAG 2.2 A and AA rule tags every view is checked against (PRD §11.2). */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

/**
 * Runs axe-core on an Electron window. Legacy mode runs in the page itself, because Electron does not let
 * Playwright open the extra page axe's default mode needs.
 */
export async function axeViolations(page: Page): Promise<readonly unknown[]> {
    const results = await new AxeBuilder({ page })
        .setLegacyMode(true)
        .withTags([...WCAG_TAGS])
        .analyze();
    return results.violations;
}

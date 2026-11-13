import { APP_IDENTITY } from '../shared/app-identity';
import { GUIDE_SECTIONS, type GuideSection } from '../shared/guide';

/** What the guide window does with a navigation: stay in the guide, open it in the browser, or refuse it. */
export type GuideNavigation = 'allow' | 'external' | 'deny';

const GUIDE_ORIGIN = `${APP_IDENTITY.appScheme}://${APP_IDENTITY.docsHost}`;

/** The guide's page, at a section when one is given (A11Y-10.4). */
export function guideUrl(section: GuideSection | undefined): string {
    const page = `${GUIDE_ORIGIN}/index.html`;
    return section === undefined ? page : `${page}#${GUIDE_SECTIONS[section]}`;
}

/** Links inside the guide stay in it; web links open in the browser; nothing else loads (SEC-01). */
export function guideNavigation(url: string): GuideNavigation {
    if (!URL.canParse(url)) {
        return 'deny';
    }
    const parsed = new URL(url);
    if (parsed.protocol === `${APP_IDENTITY.appScheme}:` && parsed.host === APP_IDENTITY.docsHost) {
        return 'allow';
    }
    return parsed.protocol === 'https:' ? 'external' : 'deny';
}

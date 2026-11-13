import { BrowserWindow } from 'electron';
import { APP_IDENTITY } from '../shared/app-identity';
import type { GuideSection } from '../shared/guide';
import type { OpenExternal } from './link-service';
import { documentWebPreferences } from './security';
import { guideNavigation, guideUrl } from './user-guide';

/** What the guide window is built from. */
export interface GuideWindowOptions {
    /** The window icon. */
    readonly icon: string;
    /** Opens web links from the guide in the browser. */
    readonly openExternal: OpenExternal;
    /** Whether the app runs behind the focused app, as test launches do (D-27); the guide then never takes focus. */
    readonly background: boolean;
}

/**
 * The user guide's own window (A11Y-10.4, P-18): the bundled HTML guide, sandboxed with no preload, so it cannot
 * reach the app. One window at a time; asking again shows it at the section asked for.
 */
export class GuideWindow {
    readonly #options: GuideWindowOptions;
    #window: BrowserWindow | undefined;

    /** A guide window that opens on demand. */
    constructor(options: GuideWindowOptions) {
        this.#options = options;
    }

    /** Opens the guide, or shows it again, at `section` when given. */
    open(section: GuideSection | undefined): void {
        const window = this.#window !== undefined && !this.#window.isDestroyed() ? this.#window : this.#create();
        void window.loadURL(guideUrl(section));
        if (this.#options.background) {
            window.showInactive();
            return;
        }
        window.show();
        window.focus();
    }

    #create(): BrowserWindow {
        const window = new BrowserWindow({
            width: 900,
            height: 800,
            title: `${APP_IDENTITY.productName} user guide`,
            icon: this.#options.icon,
            show: false,
            webPreferences: documentWebPreferences(),
        });
        window.webContents.on('will-navigate', (event, url) => {
            const decision = guideNavigation(url);
            if (decision !== 'allow') {
                event.preventDefault();
            }
            if (decision === 'external') {
                void this.#options.openExternal(url);
            }
        });
        window.webContents.setWindowOpenHandler(({ url }) => {
            if (guideNavigation(url) === 'external') {
                void this.#options.openExternal(url);
            }
            return { action: 'deny' };
        });
        this.#window = window;
        return window;
    }
}

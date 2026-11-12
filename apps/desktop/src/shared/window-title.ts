import { APP_IDENTITY } from './app-identity';

/** The active session as the window title names it. */
export interface TitledSession {
    readonly session: string;
    readonly host: string;
}

const CONTROL_CHARACTERS = /\p{Cc}/gu;
const SEPARATOR = ' — ';

/** The window title: the active session, its host and the app (A11Y-01.5), without control characters. */
export function windowTitle(active: TitledSession | undefined): string {
    if (active === undefined) {
        return APP_IDENTITY.productName;
    }
    const clean = (text: string): string => text.replace(CONTROL_CHARACTERS, '');
    return [clean(active.session), clean(active.host), APP_IDENTITY.productName].join(SEPARATOR);
}

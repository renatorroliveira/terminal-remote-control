import type { MessageFormatElement } from 'react-intl';
import english from './compiled/en.json';

/** The language P0 ships (NFR-13). */
export const DEFAULT_LOCALE = 'en';

/** The precompiled messages for a locale. */
export function messagesFor(_locale: string): Record<string, MessageFormatElement[]> {
    return english as Record<string, MessageFormatElement[]>;
}

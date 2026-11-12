import type { ReactNode } from 'react';
import { I18nProvider } from 'react-aria-components';
import { IntlProvider } from 'react-intl';
import { DEFAULT_LOCALE, messagesFor } from '../i18n/locale';

/** The providers every view needs: precompiled react-intl messages and React Aria's locale (NFR-13). */
export function AppProviders({ locale, children }: { readonly locale: string; readonly children: ReactNode }) {
    return (
        <IntlProvider locale={locale} defaultLocale={DEFAULT_LOCALE} messages={messagesFor(locale)}>
            <I18nProvider locale={locale}>{children}</I18nProvider>
        </IntlProvider>
    );
}

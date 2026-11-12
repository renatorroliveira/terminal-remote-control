import type { ReactNode } from 'react';
import { FormattedMessage } from 'react-intl';
import { APP_IDENTITY } from '../../shared/app-identity';
import { shellMessages } from '../i18n/messages';

/** What the shell shows besides its own content. */
export interface AppProps {
    /** Test builds pass the test host panel here. */
    readonly children?: ReactNode;
}

/** The application shell. Regions arrive in ST-11. */
export function App({ children }: AppProps) {
    return (
        <main aria-label={APP_IDENTITY.productName}>
            <h1>{APP_IDENTITY.productName}</h1>
            <p>
                <FormattedMessage {...shellMessages.noSession} />
            </p>
            {children}
        </main>
    );
}

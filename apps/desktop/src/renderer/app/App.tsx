import { FormattedMessage } from 'react-intl';
import { APP_IDENTITY } from '../../shared/app-identity';
import { shellMessages } from '../i18n/messages';

/** The application shell. Regions arrive in ST-11. */
export function App() {
    return (
        <main aria-label={APP_IDENTITY.productName}>
            <h1>{APP_IDENTITY.productName}</h1>
            <p>
                <FormattedMessage {...shellMessages.noSession} />
            </p>
        </main>
    );
}

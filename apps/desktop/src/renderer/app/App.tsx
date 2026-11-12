import { APP_IDENTITY } from '../../shared/app-identity';

/** The application shell. Regions arrive in ST-11. */
export function App() {
    return (
        <main aria-label={APP_IDENTITY.productName}>
            <h1>{APP_IDENTITY.productName}</h1>
        </main>
    );
}

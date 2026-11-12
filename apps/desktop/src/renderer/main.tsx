import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { windowTitle } from '../shared/window-title';
import { App } from './app/App';
import { AppProviders } from './app/AppProviders';
import { applyDisplaySettings, applyLocale } from './app/display';
import { DEFAULT_LOCALE } from './i18n/locale';
import { themeStyleSheet } from './ui/themes';
import './ui/base.css';

const root = document.documentElement;
const tokens = document.createElement('style');
tokens.textContent = themeStyleSheet();
document.head.prepend(tokens);
applyLocale(root, DEFAULT_LOCALE);
document.title = windowTitle(undefined);
window.trc.display.onChanged((settings) => applyDisplaySettings(root, settings));
void window.trc.display.get().then((settings) => applyDisplaySettings(root, settings));

const container = document.getElementById('root');
if (container !== null) {
    createRoot(container).render(
        <StrictMode>
            <AppProviders locale={DEFAULT_LOCALE}>
                <App />
            </AppProviders>
        </StrictMode>,
    );
}

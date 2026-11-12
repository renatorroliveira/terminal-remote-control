import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { windowTitle } from '../shared/window-title';
import { App } from './app/App';
import { AppProviders } from './app/AppProviders';
import { AssistiveTechnology } from './app/assistive-technology';
import { applyDisplaySettings, applyLocale } from './app/display';
import { receiveConnectionPorts } from './connection/connection-port';
import { HostClient } from './connection/host-client';
import { DevHostPanel } from './dev/DevHostPanel';
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

const assistiveTechnology = new AssistiveTechnology(window.trc.accessibility);
const isAssistiveTechnologyActive = (): boolean => assistiveTechnology.active;
const container = document.getElementById('root');
if (container !== null) {
    const reactRoot = createRoot(container);
    const render = (client: HostClient | undefined): void =>
        reactRoot.render(
            <StrictMode>
                <AppProviders locale={DEFAULT_LOCALE}>
                    <App>
                        {__TRC_TEST_SEAM__ && client !== undefined && (
                            <DevHostPanel
                                client={client}
                                isMac={window.trc.platform === 'darwin'}
                                assistiveTechnology={isAssistiveTechnologyActive}
                            />
                        )}
                    </App>
                </AppProviders>
            </StrictMode>,
        );
    render(undefined);
    receiveConnectionPorts(window, (port) => render(new HostClient(port)));
}

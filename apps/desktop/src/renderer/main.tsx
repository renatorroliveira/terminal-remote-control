import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { themeFor } from '../shared/display';
import { windowTitle } from '../shared/window-title';
import { App } from './app/App';
import { AppProviders } from './app/AppProviders';
import { AssistiveTechnology } from './app/assistive-technology';
import { type ComposedWorkspace, composeWorkspace } from './app/compose-workspace';
import { applyDisplaySettings, applyLocale } from './app/display';
import { receiveConnectionPorts } from './connection/connection-port';
import { HostClient } from './connection/host-client';
import { DEFAULT_LOCALE } from './i18n/locale';
import { type TerminalPalette, THEMES, themeStyleSheet } from './ui/themes';
import './ui/fonts.css';
import './ui/base.css';

const root = document.documentElement;
const tokens = document.createElement('style');
tokens.textContent = themeStyleSheet();
document.head.prepend(tokens);
applyLocale(root, DEFAULT_LOCALE);
document.title = windowTitle(undefined);

let palette: TerminalPalette = THEMES.midnight.terminal;
let composed: ComposedWorkspace | undefined;
const onDisplay = (settings: Parameters<typeof applyDisplaySettings>[1]): void => {
    applyDisplaySettings(root, settings);
    palette = THEMES[themeFor(settings)].terminal;
    composed?.terminals.setPalette(palette);
};
window.trc.display.onChanged(onDisplay);
void window.trc.display.get().then(onDisplay);

const assistiveTechnology = new AssistiveTechnology(window.trc.accessibility);
const container = document.getElementById('root');
if (container !== null) {
    const reactRoot = createRoot(container);
    receiveConnectionPorts(window, (port) => {
        composed?.terminals.dispose();
        composed = composeWorkspace({
            client: new HostClient(port),
            isMac: window.trc.platform === 'darwin',
            assistiveTechnology: () => assistiveTechnology.active,
            palette,
            hosts: window.trc.hosts,
        });
        const { workspace, terminals } = composed;
        void workspace.load();
        reactRoot.render(
            <StrictMode>
                <AppProviders locale={DEFAULT_LOCALE}>
                    <App workspace={workspace} terminals={terminals} askInstallLocation={__TRC_TEST_SEAM__} />
                </AppProviders>
            </StrictMode>,
        );
    });
}

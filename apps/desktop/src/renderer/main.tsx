import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createIntl } from 'react-intl';
import { themeFor } from '../shared/display';
import { resolveKeymap } from '../shared/keymap';
import { windowTitle } from '../shared/window-title';
import { App } from './app/App';
import { AppProviders } from './app/AppProviders';
import { Announcer, LiveRegionSink } from './app/announcer';
import { AssistiveTechnology } from './app/assistive-technology';
import { type ComposedWorkspace, composeWorkspace } from './app/compose-workspace';
import { applyDisplaySettings, applyLocale } from './app/display';
import { NotificationCenter } from './app/notifications';
import { applyTerminalSettings } from './app/settings/settings-effects';
import { SettingsStore } from './app/settings/settings-store';
import { Shell } from './app/shell';
import { receiveConnectionPorts } from './connection/connection-port';
import { HostClient } from './connection/host-client';
import { DEFAULT_LOCALE, messagesFor } from './i18n/locale';
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
let reducedMotion = false;
const onDisplay = (settings: Parameters<typeof applyDisplaySettings>[1]): void => {
    applyDisplaySettings(root, settings);
    palette = THEMES[themeFor(settings)].terminal;
    reducedMotion = settings.reducedMotion;
    composed?.terminals.setPalette(palette);
    composed?.terminals.setReducedMotion(reducedMotion);
};
window.trc.display.onChanged(onDisplay);
void window.trc.display.get().then(onDisplay);

const assistiveTechnology = new AssistiveTechnology(window.trc.accessibility);
const intl = createIntl({ locale: DEFAULT_LOCALE, messages: messagesFor(DEFAULT_LOCALE) });
const announcements = document.createElement('div');
document.body.append(announcements);
const announcer = new Announcer(new LiveRegionSink(announcements));
const notifications = new NotificationCenter();
const keymap = resolveKeymap({});
const settings = new SettingsStore(window.trc.settings);
const settingsLoaded = settings.load();
const narrow = window.matchMedia('(max-width: 800px)');
let shell: Shell | undefined;
let stopTerminalSettings = (): void => undefined;
window.trc.commands.onCommand((command) => shell?.run(command));
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
            speech: {
                announcer,
                screenReader: () => assistiveTechnology.screenReader,
                isMuted: (key) => shell?.isMuted(key) ?? false,
            },
            onOpenLink: (link) => void shell?.openLink(link),
            onPasteRequest: (key, text) => shell?.requestPaste(key, text),
            onNotice: (key, notice) => shell?.terminalNotice(key, notice),
            onContextMenu: (canCopy) => void window.trc.menus.terminal(canCopy),
            onClipboardWrite: (key, text) => {
                void window.trc.clipboard.write(text);
                shell?.terminalNotice(key, { kind: 'clipboard-written' });
            },
            settings: () => settings.current,
        });
        const { workspace, terminals } = composed;
        terminals.setReducedMotion(reducedMotion);
        stopTerminalSettings();
        stopTerminalSettings = applyTerminalSettings(settings, terminals);
        shell = new Shell({
            workspace,
            terminals,
            sidebar: window.trc.sidebar,
            announcer,
            notifications,
            keymap,
            intl,
            document,
            isNarrow: () => narrow.matches,
            screenReader: assistiveTechnology,
            links: window.trc.links,
            settings,
            guide: { open: (section) => void window.trc.help.openGuide(section) },
        });
        void settingsLoaded.then(() => workspace.load()).then(() => workspace.connectAll());
        reactRoot.render(
            <StrictMode>
                <AppProviders locale={DEFAULT_LOCALE}>
                    <App workspace={workspace} terminals={terminals} shell={shell} />
                </AppProviders>
            </StrictMode>,
        );
    });
}

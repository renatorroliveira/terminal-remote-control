import type { IntlShape, MessageDescriptor } from 'react-intl';
import { formatChord } from '../../shared/keymap';
import { hostActionMessages } from '../sessions/host-messages';
import { connectionActionMessages, hostSessionsMessages } from '../sessions/messages';
import { paletteSessionMessages, sessionActionMessages } from '../sessions/session-messages';
import type { WorkspaceController } from '../sessions/workspace-controller';
import { type HostEntry, hostGroups, isConnected, type SessionItem } from '../sessions/workspace-model';
import type { Shell } from './shell';
import { paletteMessages } from './shell-messages';

/** One thing the user can do, in a context menu or the command palette (A11Y-11.11). */
export interface WorkspaceAction {
    readonly id: string;
    readonly label: string;
    /** The shortcut that runs it, as text, when it has one. */
    readonly shortcut?: string;
    run(): void;
}

/**
 * A host's actions: a new session while it is connected; connect, disconnect or cancel; and, with the shell, test
 * the connection, move the install location and forget the host (US-1.1.5, US-1.4.3, A11Y-11.9).
 */
export function hostActions(
    intl: IntlShape,
    workspace: WorkspaceController,
    host: HostEntry,
    shell?: Shell,
): readonly WorkspaceAction[] {
    const action = workspace.connectionAction(host);
    const named = (id: string, message: MessageDescriptor, run: () => void): WorkspaceAction => ({
        id: `${host.id}:${id}`,
        label: intl.formatMessage(message, { host: host.destination }),
        run,
    });
    const create = isConnected(host)
        ? [named('new-session', hostSessionsMessages.newSession, () => void workspace.newSession(host.id))]
        : [];
    const connection =
        action === 'review-key'
            ? []
            : [named(action, connectionActionMessages[action], () => workspace.toggleConnection(host.id))];
    const managed =
        shell === undefined
            ? []
            : [
                  ...(action === 'connect'
                      ? [named('test', hostActionMessages.test, () => void shell.testConnection(host.id))]
                      : []),
                  named('install-root', hostActionMessages.installRoot, () =>
                      shell.setHostDialog({ kind: 'install-root', hostId: host.id }),
                  ),
                  named('forget', hostActionMessages.forget, () =>
                      shell.setHostDialog({ kind: 'forget', hostId: host.id }),
                  ),
              ];
    return [...create, ...connection, ...managed];
}

/** Where a session sits among its host's sessions. */
export interface SessionPosition {
    readonly index: number;
    readonly count: number;
}

/**
 * A session's actions in its context menu (US-1.10): open, and with the shell rename, stop while it runs, restart,
 * duplicate, move up or down, and close after a confirmation.
 */
export function sessionActions(
    intl: IntlShape,
    workspace: WorkspaceController,
    item: SessionItem,
    context: SessionContext = {},
): readonly WorkspaceAction[] {
    const open = {
        id: `${item.key}:open`,
        label: intl.formatMessage(sessionActionMessages.open),
        run: () => workspace.open(item.key),
    };
    const { shell } = context;
    if (shell === undefined) {
        return [open];
    }
    const labelled: Labelled = (id, run) => ({
        id: `${item.key}:${id}`,
        label: intl.formatMessage(sessionActionMessages[id]),
        run,
    });
    const position = context.position ?? { index: 0, count: 1 };
    return [open, ...managedSessionActions({ workspace, item, shell, position, labelled })];
}

/** What a session's actions depend on beyond the session: the shell, and its place in its host's list. */
export interface SessionContext {
    readonly shell?: Shell | undefined;
    readonly position?: SessionPosition;
}

/**
 * Everything the command palette offers (A11Y-11.11): the shell's commands with their shortcuts, the open
 * session's actions, every host's actions, and opening each session.
 */
export function paletteActions(
    intl: IntlShape,
    shell: Shell,
    workspace: WorkspaceController,
): readonly WorkspaceAction[] {
    const commands = shell.commands.list().map((command) => {
        const chord = shell.keymap.chordFor(command.id);
        return {
            id: command.id,
            label: command.label,
            ...(chord === undefined ? {} : { shortcut: formatChord(chord) }),
            run: () => command.run(),
        };
    });
    const groups = hostGroups(workspace.store.getState());
    const hosts = workspace.store.getState().hosts.flatMap((host) => hostActions(intl, workspace, host, shell));
    const sessions = groups.flatMap((group) =>
        group.sessions.map((item) => ({
            id: `${item.key}:open`,
            label: intl.formatMessage(paletteMessages.openSession, {
                session: item.label,
                host: group.host.destination,
            }),
            run: () => workspace.open(item.key),
        })),
    );
    return [...commands, ...openSessionActions(intl, shell, workspace), ...hosts, ...sessions];
}

type Labelled = (id: Exclude<keyof typeof sessionActionMessages, 'open'>, run: () => void) => WorkspaceAction;

interface ManagedContext {
    readonly workspace: WorkspaceController;
    readonly item: SessionItem;
    readonly shell: Shell;
    readonly position: SessionPosition;
    readonly labelled: Labelled;
}

function managedSessionActions({
    workspace,
    item,
    shell,
    position,
    labelled,
}: ManagedContext): readonly WorkspaceAction[] {
    const running = item.session.state === 'running' || item.session.state === 'starting';
    return [
        labelled('rename', () => shell.setSessionDialog({ kind: 'rename', key: item.key })),
        ...(running ? [labelled('stop', () => void workspace.stopSession(item.key))] : []),
        labelled('restart', () => void workspace.restartSession(item.key)),
        labelled('duplicate', () => void workspace.duplicateSession(item.key)),
        ...(position.index > 0
            ? [labelled('moveUp', () => void workspace.moveSession(item.key, position.index - 1))]
            : []),
        ...(position.index < position.count - 1
            ? [labelled('moveDown', () => void workspace.moveSession(item.key, position.index + 1))]
            : []),
        labelled('close', () => shell.setSessionDialog({ kind: 'close', key: item.key })),
    ];
}

function openSessionActions(intl: IntlShape, shell: Shell, workspace: WorkspaceController): readonly WorkspaceAction[] {
    const open = workspace.store.getState().open;
    for (const group of hostGroups(workspace.store.getState())) {
        const index = group.sessions.findIndex((item) => item.key === open);
        const item = group.sessions[index];
        if (item !== undefined) {
            const labelled: Labelled = (id, run) => ({
                id: `${item.key}:palette-${id}`,
                label: intl.formatMessage(paletteSessionMessages[id], { session: item.label }),
                run,
            });
            const position = { index, count: group.sessions.length };
            return managedSessionActions({ workspace, item, shell, position, labelled });
        }
    }
    return [];
}

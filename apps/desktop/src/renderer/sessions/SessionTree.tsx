import { type DragEvent, type KeyboardEvent, useRef, useState } from 'react';
import { type IntlShape, useIntl } from 'react-intl';
import { useStore } from 'zustand';
import { useShell } from '../app/shell-context';
import { contextMenuMessages } from '../app/shell-messages';
import { hostActions, sessionActions } from '../app/workspace-actions';
import { useContextMenu } from '../ui/context-menu';
import { PlusIcon } from '../ui/icons';
import { hostStateText } from './host-state-text';
import { typeAhead } from './list-keys';
import { hostSessionsMessages, sessionRowMessage } from './messages';
import styles from './SessionTree.module.css';
import { hostRowMessage, sessionRowWithBadgeMessage, treeMessages } from './session-messages';
import { sessionStateText } from './session-state-text';
import { type TreeRow, treeAction } from './tree-keys';
import type { WorkspaceController } from './workspace-controller';
import { type HostGroup, hostGroups, isConnected, type SessionItem } from './workspace-model';

/** What the session tree shows and reports. */
export interface SessionTreeProps {
    readonly workspace: WorkspaceController;
    /** Called after a session opens, so a narrow layout can hide the panel. */
    readonly onOpened: () => void;
}

/** Marks the + buttons. */
export const NEW_SESSION_ATTRIBUTE = 'data-new-session';

/** Marks the tree, whose current row takes focus when the focused session disappears. */
export const SESSION_TREE_ATTRIBUTE = 'data-session-tree';

const TYPE_AHEAD_MS = 500;
const DRAG_TYPE = 'application/x-trc-session';

/**
 * The sessions as an APG tree (US-1.6.4): each host, with its state and a + button that starts a session there
 * (US-1.7.1), then its sessions, each naming its state and badges (US-1.9.3) and its position. One tab stop; arrow
 * keys, Home, End and type-ahead move focus without opening (US-1.8.1); Enter, Space or a click opens a session or
 * toggles a host. Every row has a context menu (A11Y-11.11), and sessions reorder by dragging (US-1.10.6).
 */
export function SessionTree({ workspace, onOpened }: SessionTreeProps) {
    const intl = useIntl();
    const shell = useShell();
    const state = useStore(workspace.store);
    const groups = hostGroups(state);
    const rows = treeRows(groups);
    const focus = useTreeFocus(rows, state.open);
    const run = (action: ReturnType<typeof treeAction>): boolean => {
        if (action.kind === 'focus') {
            focus.moveTo(action.index);
        } else if (action.kind === 'toggle') {
            workspace.toggle(action.key);
        } else if (action.kind === 'open') {
            workspace.open(action.key);
            onOpened();
        }
        return action.kind !== 'none';
    };
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number): void => {
        if (run(treeAction(rows, index, event.key)) || focus.typeTo(event, index)) {
            event.preventDefault();
        }
    };
    const { triggerProps, menu } = useContextMenu((origin) => {
        const key = origin.closest<HTMLElement>('[data-tree-key]')?.dataset['treeKey'];
        return menuFor({ intl, workspace, groups, shell }, key);
    });
    return (
        <div
            role="tree"
            aria-label={intl.formatMessage(treeMessages.label)}
            {...{ [SESSION_TREE_ATTRIBUTE]: '' }}
            className={styles['tree']}
            {...triggerProps}
        >
            {groups.map((group, hostIndex) => (
                <HostRows
                    key={group.host.id}
                    group={group}
                    position={{ index: hostIndex, count: groups.length }}
                    rows={rows}
                    open={state.open}
                    focus={focus}
                    workspace={workspace}
                    onKeyDown={onKeyDown}
                    onOpened={onOpened}
                />
            ))}
            {menu}
        </div>
    );
}

interface Position {
    readonly index: number;
    readonly count: number;
}

interface HostRowsProps {
    readonly group: HostGroup;
    readonly position: Position;
    readonly rows: readonly TreeRow[];
    readonly open: string | undefined;
    readonly focus: TreeFocus;
    readonly workspace: WorkspaceController;
    readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>, index: number) => void;
    readonly onOpened: () => void;
}

function HostRows(props: HostRowsProps) {
    const intl = useIntl();
    const { group, rows, focus, workspace } = props;
    const { host } = group;
    const index = rows.findIndex((row) => row.key === host.id);
    const stateText = hostStateText(intl, host);
    return (
        <>
            <div
                ref={(element) => focus.register(host.id, element)}
                role="treeitem"
                aria-level={1}
                aria-posinset={props.position.index + 1}
                aria-setsize={props.position.count}
                aria-expanded={group.expanded}
                aria-label={intl.formatMessage(hostRowMessage, { host: host.destination, state: stateText })}
                tabIndex={focus.current?.key === host.id ? 0 : -1}
                data-tree-key={host.id}
                className={styles['host']}
                onFocus={() => focus.focused(host.id)}
                onKeyDown={(event) => props.onKeyDown(event, index)}
                onClick={() => workspace.toggle(host.id)}
            >
                <span aria-hidden="true" className={styles['caret']}>
                    {group.expanded ? '▾' : '▸'}
                </span>
                <span id={`${host.id}-tree-name`} className={styles['name']}>
                    {host.destination}
                </span>{' '}
                <span className={styles['state']}>{stateText}</span>
                {isConnected(host) && (
                    <button
                        type="button"
                        tabIndex={-1}
                        {...{ [NEW_SESSION_ATTRIBUTE]: '' }}
                        className={styles['add']}
                        aria-label={intl.formatMessage(hostSessionsMessages.newSession, { host: host.destination })}
                        onClick={(event) => {
                            event.stopPropagation();
                            void workspace.newSession(host.id).then(props.onOpened);
                        }}
                    >
                        <PlusIcon />
                    </button>
                )}
            </div>
            {group.expanded &&
                group.sessions.map((item, sessionIndex) => (
                    <SessionRow
                        {...props}
                        key={item.key}
                        item={item}
                        hostId={host.id}
                        position={{ index: sessionIndex, count: group.sessions.length }}
                        rowIndex={rows.findIndex((row) => row.key === item.key)}
                    />
                ))}
        </>
    );
}

interface SessionRowProps extends HostRowsProps {
    readonly item: SessionItem;
    readonly hostId: string;
    readonly rowIndex: number;
}

function SessionRow(props: SessionRowProps) {
    const intl = useIntl();
    const { item, focus, workspace } = props;
    const state = sessionStateText(intl, item);
    const badges = [
        ...(item.unread ? [intl.formatMessage(treeMessages.newOutput)] : []),
        ...(item.bell ? [intl.formatMessage(treeMessages.bell)] : []),
    ];
    const badge = badges.length === 0 ? undefined : intl.formatList(badges, { type: 'unit' });
    const label =
        badge === undefined
            ? intl.formatMessage(sessionRowMessage, { name: item.label, state })
            : intl.formatMessage(sessionRowWithBadgeMessage, { name: item.label, state, badge });
    return (
        <div
            ref={(element) => focus.register(item.key, element)}
            role="treeitem"
            aria-level={2}
            aria-posinset={props.position.index + 1}
            aria-setsize={props.position.count}
            aria-selected={item.key === props.open}
            aria-label={label}
            aria-describedby={`${props.hostId}-tree-name`}
            tabIndex={focus.current?.key === item.key ? 0 : -1}
            data-tree-key={item.key}
            data-session-key={item.key}
            draggable
            className={styles['session']}
            onFocus={() => focus.focused(item.key)}
            onKeyDown={(event) => props.onKeyDown(event, props.rowIndex)}
            onClick={() => {
                workspace.open(item.key);
                props.onOpened();
            }}
            onDragStart={(event) => event.dataTransfer.setData(DRAG_TYPE, item.key)}
            onDragOver={(event) => acceptsDrop(event, props.hostId) && event.preventDefault()}
            onDrop={(event) => drop(event, workspace, props.hostId, props.position.index)}
        >
            <span aria-hidden="true" className={styles['icon']}>
                {item.session.state === 'running' ? '●' : '○'}
            </span>
            <span className={styles['text']}>
                <span>{item.label}</span> <span className={styles['state']}>{state}</span>
                {badge !== undefined && <span className={styles['badge']}> {badge}</span>}
            </span>
        </div>
    );
}

interface TreeFocus {
    readonly current: TreeRow | undefined;
    moveTo(index: number): void;
    typeTo(event: KeyboardEvent<HTMLDivElement>, index: number): boolean;
    register(key: string, element: HTMLElement | null): void;
    focused(key: string): void;
}

function useTreeFocus(rows: readonly TreeRow[], open: string | undefined): TreeFocus {
    const [focusedKey, setFocusedKey] = useState<string>();
    const elements = useRef(new Map<string, HTMLElement>());
    const typed = useRef({ text: '', at: 0 });
    const current = rows.find((row) => row.key === focusedKey) ?? rows.find((row) => row.key === open) ?? rows[0];
    const moveTo = (index: number): void => {
        const target = rows[index];
        if (target !== undefined) {
            setFocusedKey(target.key);
            elements.current.get(target.key)?.focus();
        }
    };
    const typeTo = (event: KeyboardEvent<HTMLDivElement>, index: number): boolean => {
        if (event.key.length !== 1 || event.key === ' ' || event.ctrlKey || event.metaKey || event.altKey) {
            return false;
        }
        const now = performance.now();
        const text = now - typed.current.at < TYPE_AHEAD_MS ? typed.current.text + event.key : event.key;
        typed.current = { text, at: now };
        const found = typeAhead(
            rows.map((row) => row.label),
            text.length > 1 ? index - 1 : index,
            text,
        );
        if (found !== undefined) {
            moveTo(found);
        }
        return found !== undefined;
    };
    const register = (key: string, element: HTMLElement | null): void => {
        if (element === null) {
            elements.current.delete(key);
        } else {
            elements.current.set(key, element);
        }
    };
    return { current, moveTo, typeTo, register, focused: setFocusedKey };
}

function treeRows(groups: readonly HostGroup[]): readonly TreeRow[] {
    return groups.flatMap((group): readonly TreeRow[] => [
        { kind: 'host', key: group.host.id, expanded: group.expanded, label: group.host.destination },
        ...(group.expanded
            ? group.sessions.map((item): TreeRow => ({
                  kind: 'session',
                  key: item.key,
                  hostKey: group.host.id,
                  label: item.label,
              }))
            : []),
    ]);
}

interface MenuSources {
    readonly intl: IntlShape;
    readonly workspace: WorkspaceController;
    readonly groups: readonly HostGroup[];
    readonly shell: ReturnType<typeof useShell>;
}

function menuFor({ intl, workspace, groups, shell }: MenuSources, key: string | undefined) {
    for (const group of groups) {
        if (group.host.id === key) {
            return {
                label: intl.formatMessage(contextMenuMessages.label, { target: group.host.destination }),
                items: hostActions(intl, workspace, group.host, shell),
            };
        }
        const index = group.sessions.findIndex((item) => item.key === key);
        const item = group.sessions[index];
        if (item !== undefined) {
            return {
                label: intl.formatMessage(contextMenuMessages.label, { target: item.label }),
                items: sessionActions(intl, workspace, item, {
                    shell,
                    position: { index, count: group.sessions.length },
                }),
            };
        }
    }
    return undefined;
}

function acceptsDrop(event: DragEvent<HTMLElement>, hostId: string): boolean {
    return (
        event.dataTransfer.types.includes(DRAG_TYPE) &&
        event.currentTarget.dataset['sessionKey']?.startsWith(`${hostId}/`) === true
    );
}

function drop(event: DragEvent<HTMLElement>, workspace: WorkspaceController, hostId: string, index: number): void {
    const dragged = event.dataTransfer.getData(DRAG_TYPE);
    if (dragged.startsWith(`${hostId}/`)) {
        event.preventDefault();
        void workspace.moveSession(dragged, index);
    }
}

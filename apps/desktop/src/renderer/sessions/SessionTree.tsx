import { type KeyboardEvent, useRef, useState } from 'react';
import { type IntlShape, useIntl } from 'react-intl';
import {
    exitedCodeMessage,
    exitedSignalMessage,
    hostStateMessages,
    sessionStateMessages,
    sidebarMessages,
    treeItemMessage,
} from './messages';
import styles from './SessionTree.module.css';
import { treeAction, typeAhead } from './tree-keys';
import type { HostEntry, TreeItem } from './workspace-model';

/** What the tree shows and reports. */
export interface SessionTreeProps {
    readonly items: readonly TreeItem[];
    /** The session shown in the terminal area. */
    readonly open: string | undefined;
    readonly onOpen: (key: string) => void;
    readonly onToggle: (hostId: string) => void;
}

const TYPE_AHEAD_MS = 500;

/**
 * The session tree (US-1.6.4): hosts, then their sessions, as `role="tree"` with one tab stop. Arrow keys, Home,
 * End and type-ahead move focus; Enter or a click opens a session (US-1.8.1). Every row names its state in text.
 */
export function SessionTree(props: SessionTreeProps) {
    const intl = useIntl();
    const focus = useTreeFocus(props);
    return (
        <div role="tree" aria-label={intl.formatMessage(sidebarMessages.tree)} className={styles['tree']}>
            {props.items.map((item) => (
                <div
                    key={item.key}
                    ref={(element) => focus.register(item.key, element)}
                    role="treeitem"
                    tabIndex={item.key === focus.current?.key ? 0 : -1}
                    aria-level={item.level}
                    aria-posinset={item.posinset}
                    aria-setsize={item.setsize}
                    aria-expanded={item.kind === 'host' ? item.expanded : undefined}
                    aria-selected={item.kind === 'session' ? item.key === props.open : undefined}
                    aria-label={intl.formatMessage(treeItemMessage, { name: item.label, state: stateText(intl, item) })}
                    className={styles['row']}
                    data-kind={item.kind}
                    onFocus={() => focus.focused(item.key)}
                    onKeyDown={focus.onKeyDown}
                    onClick={() => (item.kind === 'session' ? props.onOpen(item.key) : props.onToggle(item.host.id))}
                >
                    <span aria-hidden="true" className={styles['icon']}>
                        {stateIcon(item)}
                    </span>
                    <span className={styles['text']}>
                        <span className={styles['label']}>{item.label}</span>{' '}
                        <span className={styles['state']}>{stateText(intl, item)}</span>
                    </span>
                </div>
            ))}
        </div>
    );
}

function useTreeFocus({ items, open, onOpen, onToggle }: SessionTreeProps) {
    const [focusedKey, setFocusedKey] = useState<string>();
    const rows = useRef(new Map<string, HTMLDivElement>());
    const typed = useRef({ text: '', at: 0 });
    const current =
        items.find((item) => item.key === focusedKey) ?? items.find((item) => item.key === open) ?? items[0];

    const moveTo = (index: number): void => {
        const target = items[index];
        if (target !== undefined) {
            setFocusedKey(target.key);
            rows.current.get(target.key)?.focus();
        }
    };

    const typeTo = (event: KeyboardEvent<HTMLDivElement>, index: number): void => {
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }
        const now = performance.now();
        const text = now - typed.current.at < TYPE_AHEAD_MS ? typed.current.text + event.key : event.key;
        typed.current = { text, at: now };
        const found = typeAhead(items, text.length > 1 ? index - 1 : index, text);
        if (found !== undefined) {
            event.preventDefault();
            moveTo(found);
        }
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        const index = items.findIndex((item) => item.key === current?.key);
        const action = treeAction(items, index, event.key);
        if (action.kind === 'none') {
            typeTo(event, index);
            return;
        }
        event.preventDefault();
        if (action.kind === 'focus') {
            moveTo(action.index);
        } else if (action.kind === 'open') {
            onOpen(action.key);
        } else {
            onToggle(action.hostId);
        }
    };

    const register = (key: string, element: HTMLDivElement | null): void => {
        if (element === null) {
            rows.current.delete(key);
        } else {
            rows.current.set(key, element);
        }
    };

    return { current, onKeyDown, register, focused: setFocusedKey };
}

function stateText(intl: IntlShape, item: TreeItem): string {
    if (item.kind === 'host') {
        return hostStateText(intl, item.host);
    }
    const { state, exit } = item.session;
    if (state === 'exited' && exit?.code !== undefined) {
        return intl.formatMessage(exitedCodeMessage, { code: exit.code });
    }
    if (state === 'exited' && exit?.signal !== undefined) {
        return intl.formatMessage(exitedSignalMessage, { signal: exit.signal });
    }
    return intl.formatMessage(sessionStateMessages[state]);
}

function hostStateText(intl: IntlShape, host: HostEntry): string {
    const status = host.state.status;
    return intl.formatMessage(hostStateMessages[status === 'host-key' ? 'hostKey' : status]);
}

function stateIcon(item: TreeItem): string {
    if (item.kind === 'host') {
        return item.expanded ? '▾' : '▸';
    }
    return item.session.state === 'running' ? '●' : '○';
}

import { type KeyboardEvent, useRef, useState } from 'react';
import { type IntlShape, useIntl } from 'react-intl';
import { listAction, typeAhead } from './list-keys';
import { exitedCodeMessage, exitedSignalMessage, sessionRowMessage, sessionStateMessages } from './messages';
import styles from './SessionList.module.css';
import type { SessionItem } from './workspace-model';

/** What a host's session list shows and reports. */
export interface SessionListProps {
    readonly id: string;
    /** The list's accessible name, such as "Sessions on devbox-1". */
    readonly label: string;
    readonly items: readonly SessionItem[];
    /** The session shown in the terminal area. */
    readonly open: string | undefined;
    readonly onOpen: (key: string) => void;
    readonly hidden?: boolean;
}

const TYPE_AHEAD_MS = 500;

/**
 * One host's sessions (US-1.6.4) as a `role="listbox"` with one tab stop and the open session selected. Arrow keys,
 * Home, End and type-ahead move focus; Enter, Space or a click opens a session (US-1.8.1). Every option names its
 * state in text (US-1.9.3).
 */
export function SessionList(props: SessionListProps) {
    const intl = useIntl();
    const focus = useListFocus(props);
    return (
        <div id={props.id} role="listbox" aria-label={props.label} hidden={props.hidden} className={styles['list']}>
            {props.items.map((item, index) => (
                <div
                    key={item.key}
                    ref={(element) => focus.register(item.key, element)}
                    role="option"
                    data-session-key={item.key}
                    tabIndex={item.key === focus.current?.key ? 0 : -1}
                    aria-selected={item.key === props.open}
                    aria-label={intl.formatMessage(sessionRowMessage, {
                        name: item.label,
                        state: stateText(intl, item),
                    })}
                    className={styles['row']}
                    onFocus={() => focus.focused(item.key)}
                    onKeyDown={(event) => focus.onKeyDown(event, index)}
                    onClick={() => props.onOpen(item.key)}
                >
                    <span aria-hidden="true" className={styles['icon']}>
                        {item.session.state === 'running' ? '●' : '○'}
                    </span>
                    <span className={styles['text']}>
                        <span>{item.label}</span> <span className={styles['state']}>{stateText(intl, item)}</span>
                    </span>
                </div>
            ))}
        </div>
    );
}

function useListFocus({ items, open, onOpen }: SessionListProps) {
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
        if (event.key.length !== 1 || event.key === ' ' || event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }
        const now = performance.now();
        const text = now - typed.current.at < TYPE_AHEAD_MS ? typed.current.text + event.key : event.key;
        typed.current = { text, at: now };
        const labels = items.map((item) => item.label);
        const found = typeAhead(labels, text.length > 1 ? index - 1 : index, text);
        if (found !== undefined) {
            event.preventDefault();
            moveTo(found);
        }
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number): void => {
        const action = listAction(items.length, index, event.key);
        if (action.kind === 'none') {
            typeTo(event, index);
            return;
        }
        event.preventDefault();
        if (action.kind === 'focus') {
            moveTo(action.index);
        } else {
            const target = items[action.index];
            if (target !== undefined) {
                onOpen(target.key);
            }
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

function stateText(intl: IntlShape, item: SessionItem): string {
    const { state, exit } = item.session;
    if (state === 'exited' && exit?.code !== undefined) {
        return intl.formatMessage(exitedCodeMessage, { code: exit.code });
    }
    if (state === 'exited' && exit?.signal !== undefined) {
        return intl.formatMessage(exitedSignalMessage, { signal: exit.signal });
    }
    return intl.formatMessage(sessionStateMessages[state]);
}

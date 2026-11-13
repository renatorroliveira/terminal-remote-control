import { type KeyboardEvent, type MouseEvent, type ReactNode, useRef, useState } from 'react';
import { Menu, MenuItem, Popover } from 'react-aria-components';
import styles from './context-menu.module.css';

/** One item of a context menu. */
export interface ContextMenuItem {
    readonly id: string;
    readonly label: string;
    run(): void;
}

/** The handlers that open the menu, for the element it belongs to or one that contains it. */
export interface ContextMenuTriggerProps {
    readonly onContextMenu: (event: MouseEvent<HTMLElement>) => void;
    readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/** A context menu's name and items, for the element it opens from. */
export interface ContextMenuContent {
    readonly label: string;
    readonly items: readonly ContextMenuItem[];
}

interface OpenMenu extends ContextMenuContent {
    readonly x: number;
    readonly y: number;
    /** Where focus returns when the menu closes (A11Y-05.8). */
    readonly returnTo: HTMLElement | undefined;
}

const FOCUSABLE = 'button, [role="option"], [tabindex]';

/**
 * A context menu (A11Y-11.11) that opens on a secondary click, Control+click on macOS, Shift+F10 and the Menu key, at
 * the pointer or below the focused element. It takes focus on its first item; choosing one, or Escape, closes it and
 * returns focus to the element it opened from, and only then runs the choice.
 */
export function useContextMenu(contentFor: (origin: HTMLElement) => ContextMenuContent | undefined): {
    readonly triggerProps: ContextMenuTriggerProps;
    readonly menu: ReactNode;
} {
    const [open, setOpen] = useState<OpenMenu | undefined>();
    const anchor = useRef<HTMLDivElement>(null);
    const openAt = (origin: HTMLElement, x: number, y: number): void => {
        const content = contentFor(origin);
        if (content !== undefined && content.items.length > 0) {
            setOpen({ ...content, x, y, returnTo: focusableAt(origin) });
        }
    };
    const close = (): HTMLElement | undefined => {
        const returnTo = open?.returnTo;
        setOpen(undefined);
        returnTo?.focus();
        return returnTo;
    };
    const triggerProps: ContextMenuTriggerProps = {
        onContextMenu: (event) => {
            event.preventDefault();
            openAt(event.target as HTMLElement, event.clientX, event.clientY);
        },
        onKeyDown: (event) => {
            if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const origin = event.target as HTMLElement;
            const bounds = origin.getBoundingClientRect();
            openAt(origin, bounds.left, bounds.bottom);
        },
    };
    const menu = open && (
        <>
            <div ref={anchor} className={styles['anchor']} style={{ left: open.x, top: open.y }} />
            <Popover
                triggerRef={anchor}
                isOpen
                placement="bottom start"
                onOpenChange={(isOpen) => isOpen || close()}
                className={styles['popover'] ?? ''}
            >
                <Menu
                    aria-label={open.label}
                    autoFocus="first"
                    className={styles['menu'] ?? ''}
                    onAction={(key) => {
                        const item = open.items.find((entry) => entry.id === key);
                        close();
                        if (item !== undefined) {
                            setTimeout(() => item.run(), 0);
                        }
                    }}
                >
                    {open.items.map((item) => (
                        <MenuItem key={item.id} id={item.id} className={styles['item'] ?? ''}>
                            {item.label}
                        </MenuItem>
                    ))}
                </Menu>
            </Popover>
        </>
    );
    return { triggerProps, menu };
}

function focusableAt(origin: HTMLElement): HTMLElement | undefined {
    const active = origin.ownerDocument.activeElement;
    if (active instanceof HTMLElement && active !== origin.ownerDocument.body && active.contains(origin)) {
        return active;
    }
    return origin.closest<HTMLElement>(FOCUSABLE) ?? undefined;
}

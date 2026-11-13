import { type KeyboardEvent, type PointerEvent, useRef } from 'react';
import { useIntl } from 'react-intl';
import { SIDEBAR_WIDTH } from '../../shared/layout';
import { splitterMessages } from '../sessions/messages';
import styles from './SidebarSplitter.module.css';

/** What the splitter resizes and reports. */
export interface SidebarSplitterProps {
    /** The sidebar's current width in CSS pixels. */
    readonly width: number;
    /** The sidebar's element ID. */
    readonly controls: string;
    /** The width changed, while dragging or from a key. */
    readonly onResize: (width: number) => void;
    /** The user settled on a width: a key press, or the end of a drag. */
    readonly onResized: (width: number) => void;
}

/** How far one arrow key press moves the splitter. */
const KEY_STEP = 10;

/**
 * The APG window splitter on the sidebar's right edge (US-1.6.3): drag it, or focus it and press Left or Right
 * (10 px), Home (300 px) or End (800 px). It reports the width as its value and in pixels as text.
 */
export function SidebarSplitter({ width, controls, onResize, onResized }: SidebarSplitterProps) {
    const intl = useIntl();
    const dragging = useRef(false);
    const pointerWidth = (event: PointerEvent<HTMLDivElement>): number =>
        clampWidth(event.clientX - (event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0));
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        const next = keyWidth(event.key, width);
        if (next !== undefined) {
            event.preventDefault();
            onResize(next);
            onResized(next);
        }
    };
    const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
        if (event.button === 0) {
            event.preventDefault();
            dragging.current = true;
            capture(event);
        }
    };
    const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
        if (dragging.current) {
            onResize(pointerWidth(event));
        }
    };
    const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
        if (dragging.current) {
            dragging.current = false;
            onResized(pointerWidth(event));
        }
    };
    return (
        // biome-ignore lint/a11y/useSemanticElements: an APG window splitter is a focusable separator widget, which <hr> is not.
        <div
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-controls={controls}
            aria-label={intl.formatMessage(splitterMessages.label)}
            aria-valuenow={width}
            aria-valuemin={SIDEBAR_WIDTH.min}
            aria-valuemax={SIDEBAR_WIDTH.max}
            aria-valuetext={intl.formatMessage(splitterMessages.value, { width })}
            className={styles['splitter']}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
        />
    );
}

/** A width inside the range the sidebar allows. */
export function clampWidth(width: number): number {
    return Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)));
}

function keyWidth(key: string, width: number): number | undefined {
    switch (key) {
        case 'ArrowLeft':
            return clampWidth(width - KEY_STEP);
        case 'ArrowRight':
            return clampWidth(width + KEY_STEP);
        case 'Home':
            return SIDEBAR_WIDTH.min;
        case 'End':
            return SIDEBAR_WIDTH.max;
        default:
            return undefined;
    }
}

function capture(event: PointerEvent<HTMLDivElement>): void {
    try {
        event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
        return;
    }
}

/** The terminal text size, in percent of the default: 50% to 200% in steps of 10% (A11Y-07.4). */
export const TERMINAL_ZOOM = { min: 50, max: 200, step: 10, initial: 100 } as const;

/** A change of the terminal text size. */
export type ZoomChange = 'in' | 'out' | 'reset';

/** The text size after `change`, kept within {@link TERMINAL_ZOOM}. */
export function nextZoom(current: number, change: ZoomChange): number {
    if (change === 'reset') {
        return TERMINAL_ZOOM.initial;
    }
    const stepped = current + (change === 'in' ? TERMINAL_ZOOM.step : -TERMINAL_ZOOM.step);
    return Math.min(TERMINAL_ZOOM.max, Math.max(TERMINAL_ZOOM.min, stepped));
}

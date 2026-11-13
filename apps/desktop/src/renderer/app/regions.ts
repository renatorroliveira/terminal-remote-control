/** The window's regions, in focus order (US-1.6.1, A11Y-05.2). */
export const REGION_ORDER = ['sidebar', 'terminal', 'status'] as const;

/** A region's ID. */
export type RegionId = (typeof REGION_ORDER)[number];

/** The attribute that marks a region's element. */
export const REGION_ATTRIBUTE = 'data-region';

/** A region's own way in, such as focusing the open terminal; false when it has none right now. */
export type RegionEntry = () => boolean;

const TABBABLE =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Moves keyboard focus between the regions (A11Y-05.2): to the control that last had focus there, else the region's
 * own entry, else its first control, else the region itself. A hidden region, such as a collapsed sidebar, is
 * skipped.
 */
export class RegionCycler {
    readonly #document: Document;
    readonly #entries: Readonly<Partial<Record<RegionId, RegionEntry>>>;
    readonly #lastFocused = new Map<RegionId, HTMLElement>();

    /** Creates a cycler over the regions marked in `document`. */
    constructor(document: Document, entries: Readonly<Partial<Record<RegionId, RegionEntry>>>) {
        this.#document = document;
        this.#entries = entries;
    }

    /** Starts remembering each region's focused control; returns the stopper. */
    start(): () => void {
        const onFocusIn = (event: FocusEvent): void => {
            const target = event.target instanceof HTMLElement ? event.target : undefined;
            const region = target?.closest<HTMLElement>(`[${REGION_ATTRIBUTE}]`);
            const id = region?.getAttribute(REGION_ATTRIBUTE) as RegionId | undefined;
            if (target !== undefined && id !== undefined && target !== region) {
                this.#lastFocused.set(id, target);
            }
        };
        this.#document.addEventListener('focusin', onFocusIn);
        return () => this.#document.removeEventListener('focusin', onFocusIn);
    }

    /** Focuses the next region. */
    next(): void {
        this.#move(1);
    }

    /** Focuses the previous region. */
    previous(): void {
        this.#move(-1);
    }

    #move(step: 1 | -1): void {
        const regions = this.#visibleRegions();
        if (regions.length === 0) {
            return;
        }
        const active = this.#document.activeElement;
        const current = regions.findIndex(([, element]) => element.contains(active));
        const start = current === -1 ? (step === 1 ? -1 : 0) : current;
        const target = regions[(start + step + regions.length) % regions.length];
        if (target !== undefined) {
            this.#enter(target[0], target[1]);
        }
    }

    #visibleRegions(): readonly (readonly [RegionId, HTMLElement])[] {
        return REGION_ORDER.flatMap((id) => {
            const element = this.#document.querySelector<HTMLElement>(`[${REGION_ATTRIBUTE}="${id}"]`);
            return element?.checkVisibility() === true ? [[id, element] as const] : [];
        });
    }

    #enter(id: RegionId, region: HTMLElement): void {
        const remembered = this.#lastFocused.get(id);
        if (remembered !== undefined && region.contains(remembered) && remembered.checkVisibility()) {
            remembered.focus();
            return;
        }
        if (this.#entries[id]?.() === true) {
            return;
        }
        const first = [...region.querySelectorAll<HTMLElement>(TABBABLE)].find((element) => element.checkVisibility());
        if (first !== undefined) {
            first.focus();
            return;
        }
        region.tabIndex = -1;
        region.focus();
    }
}

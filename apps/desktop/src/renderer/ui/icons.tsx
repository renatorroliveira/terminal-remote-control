/** Icons draw shape only; their buttons carry the name and description, so every icon is hidden from AT. */
interface IconProps {
    readonly className?: string | undefined;
}

const SIZE = 20;
const RADIUS = 6.5;
const STROKE = 1.8;

/** A connected host: a filled dot. */
export function ConnectedIcon({ className }: IconProps) {
    return (
        <svg aria-hidden="true" focusable="false" width={SIZE} height={SIZE} viewBox="0 0 20 20" className={className}>
            <circle cx="10" cy="10" r={RADIUS} fill="currentColor" />
        </svg>
    );
}

/** A disconnected host: a hollow ring. */
export function DisconnectedIcon({ className }: IconProps) {
    return (
        <svg aria-hidden="true" focusable="false" width={SIZE} height={SIZE} viewBox="0 0 20 20" className={className}>
            <circle cx="10" cy="10" r={RADIUS} fill="none" stroke="currentColor" strokeWidth={STROKE} />
        </svg>
    );
}

/** A host that is connecting or waits for the user: a ring filled halfway, between the other two. */
export function BusyIcon({ className }: IconProps) {
    return (
        <svg aria-hidden="true" focusable="false" width={SIZE} height={SIZE} viewBox="0 0 20 20" className={className}>
            <circle cx="10" cy="10" r={RADIUS} fill="none" stroke="currentColor" strokeWidth={STROKE} />
            <path d="M10 3.5A6.5 6.5 0 0 1 10 16.5Z" fill="currentColor" />
        </svg>
    );
}

/** A plus sign, for buttons that create something. */
export function PlusIcon({ className }: IconProps) {
    return (
        <svg aria-hidden="true" focusable="false" width={SIZE} height={SIZE} viewBox="0 0 20 20" className={className}>
            <path d="M10 4V16M4 10H16" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" />
        </svg>
    );
}

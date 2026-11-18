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

/** A session that ended (exited, stopped or failed to start): a ring with a dash across it (P-48). */
export function EndedIcon({ className }: IconProps) {
    return (
        <svg aria-hidden="true" focusable="false" width={SIZE} height={SIZE} viewBox="0 0 20 20" className={className}>
            <circle cx="10" cy="10" r={RADIUS} fill="none" stroke="currentColor" strokeWidth={STROKE} />
            <path d="M6.5 10H13.5" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" />
        </svg>
    );
}

/** The notification list: a bell. */
export function NotificationsIcon({ className }: IconProps) {
    return (
        <svg aria-hidden="true" focusable="false" width={SIZE} height={SIZE} viewBox="0 0 20 20" className={className}>
            <path
                d="M5.5 13.5V9a4.5 4.5 0 0 1 9 0v4.5l1.5 1.5H4ZM8.5 16.5a1.5 1.5 0 0 0 3 0"
                fill="none"
                stroke="currentColor"
                strokeWidth={STROKE}
                strokeLinejoin="round"
                strokeLinecap="round"
            />
        </svg>
    );
}

/** A finished command: a prompt's chevron with a tick (US-5.3.2). */
export function CommandFinishedIcon({ className }: IconProps) {
    return (
        <svg aria-hidden="true" focusable="false" width={SIZE} height={SIZE} viewBox="0 0 20 20" className={className}>
            <path
                d="M3.5 6.5 7 10l-3.5 3.5M10 13.5l2.5 2.5 5-6"
                fill="none"
                stroke="currentColor"
                strokeWidth={STROKE}
                strokeLinejoin="round"
                strokeLinecap="round"
            />
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

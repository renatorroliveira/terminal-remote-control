/** Icons draw shape only; their buttons carry the name and description, so every icon is hidden from AT. */
interface IconProps {
    readonly className?: string | undefined;
}

const SIZE = 16;

/** A connected host: a filled disc with a check mark. */
export function ConnectedIcon({ className }: IconProps) {
    return (
        <svg aria-hidden="true" focusable="false" width={SIZE} height={SIZE} viewBox="0 0 16 16" className={className}>
            <circle cx="8" cy="8" r="7" fill="currentColor" />
            <path d="M4.5 8.2 7 10.6 11.6 5.6" fill="none" stroke="var(--trc-color-background)" strokeWidth="1.8" />
        </svg>
    );
}

/** A disconnected host: a ring with a slash through it. */
export function DisconnectedIcon({ className }: IconProps) {
    return (
        <svg aria-hidden="true" focusable="false" width={SIZE} height={SIZE} viewBox="0 0 16 16" className={className}>
            <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M3.6 12.4 12.4 3.6" stroke="currentColor" strokeWidth="1.8" />
        </svg>
    );
}

/** A host that is connecting or waits for the user: a ring with three dots. */
export function BusyIcon({ className }: IconProps) {
    return (
        <svg aria-hidden="true" focusable="false" width={SIZE} height={SIZE} viewBox="0 0 16 16" className={className}>
            <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="5" cy="8" r="1.2" fill="currentColor" />
            <circle cx="8" cy="8" r="1.2" fill="currentColor" />
            <circle cx="11" cy="8" r="1.2" fill="currentColor" />
        </svg>
    );
}

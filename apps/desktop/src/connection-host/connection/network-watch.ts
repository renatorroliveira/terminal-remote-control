import { type NetworkInterfaceInfo, networkInterfaces } from 'node:os';

/** How often the interface list is read. */
const POLL_MS = 2_000;

/** Reads the network interfaces, as `os.networkInterfaces` does. */
export type ReadInterfaces = () => NodeJS.Dict<NetworkInterfaceInfo[]>;

/**
 * Notices network changes — an interface or address that appears or goes, such as a new Wi-Fi network or a VPN — by
 * reading the interface list every 2 s, so the app reconnects at once instead of at its next backoff (US-2.2.2).
 */
export class NetworkWatch {
    readonly #onChange: () => void;
    readonly #read: ReadInterfaces;
    #signature: string;
    #timer: ReturnType<typeof setInterval> | undefined;

    /** A watch that calls `onChange` after every change. */
    constructor(onChange: () => void, read: ReadInterfaces = networkInterfaces) {
        this.#onChange = onChange;
        this.#read = read;
        this.#signature = this.#current();
    }

    /** Starts watching. */
    start(): void {
        this.#timer ??= setInterval(() => this.#check(), POLL_MS);
        this.#timer.unref?.();
    }

    /** Stops watching. */
    stop(): void {
        clearInterval(this.#timer);
        this.#timer = undefined;
    }

    #check(): void {
        const signature = this.#current();
        if (signature !== this.#signature) {
            this.#signature = signature;
            this.#onChange();
        }
    }

    /** The external addresses of every interface, sorted, as one string. */
    #current(): string {
        return Object.entries(this.#read())
            .flatMap(([name, addresses]) =>
                (addresses ?? []).filter((address) => !address.internal).map((address) => `${name} ${address.cidr}`),
            )
            .sort()
            .join('\n');
    }
}

import type { ServiceInfo } from '@trc/protocol';
import type { IntlShape } from 'react-intl';
import { detailsMessages } from './daemon-messages';

const UNITS = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
] as const;

/** How long a daemon that started at `startedAt` has run at `now`, in its two largest whole units (US-3.3.1). */
export function uptimeText(intl: IntlShape, startedAt: number, now: number): string {
    let rest = Math.max(0, now - startedAt);
    const parts: string[] = [];
    for (const [unit, length] of UNITS) {
        const count = Math.floor(rest / length);
        rest -= count * length;
        if (count > 0 && parts.length < 2) {
            parts.push(intl.formatNumber(count, { style: 'unit', unit, unitDisplay: 'long' }));
        } else if (parts.length > 0) {
            break;
        }
    }
    return parts.length === 0 ? intl.formatMessage(detailsMessages.lessThanAMinute) : parts.join(', ');
}

/** How the daemon runs: under the user's systemd instance, as a LaunchAgent, or on its own (US-2.4, US-3.3.1). */
export function serviceText(intl: IntlShape, service: ServiceInfo): string {
    switch (service.manager) {
        case 'systemd':
            return intl.formatMessage(detailsMessages.systemd);
        case 'launchd':
            return intl.formatMessage(detailsMessages.launchd);
        case 'detached':
            return intl.formatMessage(detailsMessages.detached);
        default:
            return intl.formatMessage(detailsMessages.unknownService);
    }
}

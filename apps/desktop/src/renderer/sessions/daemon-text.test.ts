import { createIntl } from 'react-intl';
import { describe, expect, it } from 'vitest';
import { messagesFor } from '../i18n/locale';
import { serviceText, uptimeText } from './daemon-text';

const intl = createIntl({ locale: 'en', messages: messagesFor('en') });
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('uptimeText (US-3.3.1)', () => {
    it('says how long the daemon runs in its two largest units', () => {
        expect(uptimeText(intl, 0, 2 * DAY + 3 * HOUR + 4 * MINUTE)).toBe('2 days, 3 hours');
        expect(uptimeText(intl, 0, DAY + 5 * MINUTE)).toBe('1 day');
        expect(uptimeText(intl, 0, 3 * HOUR + MINUTE)).toBe('3 hours, 1 minute');
        expect(uptimeText(intl, 0, 59 * MINUTE)).toBe('59 minutes');
        expect(uptimeText(intl, 0, 30_000)).toBe('Less than a minute');
        expect(uptimeText(intl, 10_000, 0)).toBe('Less than a minute');
    });
});

describe('serviceText (US-2.4, US-3.3.1, US-4.4.1)', () => {
    it('says how the daemon runs', () => {
        expect(serviceText(intl, { manager: 'systemd', sessionsEndAtLogout: false })).toBe('As a systemd user service');
        expect(serviceText(intl, { manager: 'launchd', sessionsEndAtLogout: false })).toBe(
            'As a LaunchAgent, which starts at login',
        );
        expect(serviceText(intl, { manager: 'detached', sessionsEndAtLogout: false })).toBe(
            'On its own, outside any service manager',
        );
        expect(serviceText(intl, { manager: 'unspecified', sessionsEndAtLogout: false })).toBe(
            'In a way this version does not know',
        );
    });
});

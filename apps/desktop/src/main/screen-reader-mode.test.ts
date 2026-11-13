import { describe, expect, it } from 'vitest';
import type { AccessibilityState, ScreenReaderMode } from '../shared/accessibility';
import { ScreenReaderSetting, screenReaderFlag } from './screen-reader-mode';

describe('screenReaderFlag: the command-line switch (A11Y-10.2)', () => {
    it('reads --screen-reader-mode=on, off or auto', () => {
        expect(screenReaderFlag(['/app', '--screen-reader-mode=on'])).toBe('on');
        expect(screenReaderFlag(['/app', '--screen-reader-mode=off'])).toBe('off');
        expect(screenReaderFlag(['/app', '--screen-reader-mode=auto'])).toBe('auto');
    });

    it('ignores a missing flag and a value it does not know', () => {
        expect(screenReaderFlag(['/app'])).toBeUndefined();
        expect(screenReaderFlag(['/app', '--screen-reader-mode=loud'])).toBeUndefined();
        expect(screenReaderFlag(['/app', '--screen-reader-mode'])).toBeUndefined();
    });
});

function setting(options: { readonly stored: ScreenReaderMode; readonly flag?: ScreenReaderMode }) {
    const support = { enabled: false };
    const saved: ScreenReaderMode[] = [];
    const changes: AccessibilityState[] = [];
    const subject = new ScreenReaderSetting({
        ...options,
        supportEnabled: () => support.enabled,
        save: async (mode) => {
            saved.push(mode);
        },
    });
    subject.onChanged((state) => changes.push(state));
    return { subject, support, saved, changes };
}

describe('ScreenReaderSetting: Chromium’s detection, the setting and the flag (A11Y-10.2)', () => {
    it('follows Chromium’s accessibility support in automatic mode', () => {
        const { subject, support, changes } = setting({ stored: 'auto' });
        expect(subject.current()).toEqual({ supportEnabled: false, mode: 'auto' });
        support.enabled = true;
        subject.supportChanged();
        expect(subject.current()).toEqual({ supportEnabled: true, mode: 'auto' });
        expect(changes).toEqual([{ supportEnabled: true, mode: 'auto' }]);
    });

    it('starts with the flag over the stored setting, without saving it', () => {
        const { subject, saved } = setting({ stored: 'off', flag: 'on' });
        expect(subject.current().mode).toBe('on');
        expect(saved).toEqual([]);
    });

    it('saves a mode the user picks and reports it', async () => {
        const { subject, saved, changes } = setting({ stored: 'auto', flag: 'on' });
        await subject.setMode('off');
        expect(subject.current().mode).toBe('off');
        expect(saved).toEqual(['off']);
        expect(changes).toEqual([{ supportEnabled: false, mode: 'off' }]);
    });

    it('stops reporting to a listener that stopped listening', () => {
        const { subject, support } = setting({ stored: 'auto' });
        const heard: AccessibilityState[] = [];
        const stop = subject.onChanged((state) => heard.push(state));
        stop();
        support.enabled = true;
        subject.supportChanged();
        expect(heard).toEqual([]);
    });
});

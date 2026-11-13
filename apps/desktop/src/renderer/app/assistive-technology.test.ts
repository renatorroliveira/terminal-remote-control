import { describe, expect, it } from 'vitest';
import type { AccessibilityState, ScreenReaderMode } from '../../shared/accessibility';
import { AssistiveTechnology } from './assistive-technology';

function tracker(first: AccessibilityState) {
    let notify: (state: AccessibilityState) => void = () => undefined;
    const modes: ScreenReaderMode[] = [];
    const subject = new AssistiveTechnology({
        get: () => Promise.resolve(first),
        setMode: async (mode) => {
            modes.push(mode);
        },
        onChanged: (listener) => {
            notify = listener;
            return () => undefined;
        },
    });
    return { subject, modes, notify: (state: AccessibilityState) => notify(state) };
}

describe('AssistiveTechnology (S3a cadence, A11Y-02, A11Y-10.2)', () => {
    it('starts inactive, then follows what the main process reports', async () => {
        const { subject, notify } = tracker({ supportEnabled: true, mode: 'auto' });
        expect(subject.active).toBe(false);
        expect(subject.screenReader).toBe(false);
        await subject.ready;
        expect(subject.active).toBe(true);
        expect(subject.screenReader).toBe(true);
        notify({ supportEnabled: false, mode: 'auto' });
        expect(subject.active).toBe(false);
        expect(subject.screenReader).toBe(false);
    });

    it('keeps the slower cadence but no spoken output when screen-reader mode is forced off', async () => {
        const { subject } = tracker({ supportEnabled: true, mode: 'off' });
        await subject.ready;
        expect(subject.active).toBe(true);
        expect(subject.screenReader).toBe(false);
        expect(subject.mode).toBe('off');
    });

    it('reports screen-reader mode turning on or off after the first answer, and only then', async () => {
        const { subject, notify } = tracker({ supportEnabled: false, mode: 'auto' });
        const heard: boolean[] = [];
        subject.onScreenReaderChanged((on) => heard.push(on));
        await subject.ready;
        notify({ supportEnabled: true, mode: 'auto' });
        notify({ supportEnabled: true, mode: 'on' });
        notify({ supportEnabled: true, mode: 'off' });
        expect(heard).toEqual([true, false]);
    });

    it('asks the main process to keep a mode the user picks', async () => {
        const { subject, modes } = tracker({ supportEnabled: false, mode: 'auto' });
        await subject.setMode('on');
        expect(modes).toEqual(['on']);
    });
});

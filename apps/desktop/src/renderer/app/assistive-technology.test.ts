import { describe, expect, it } from 'vitest';
import { AssistiveTechnology } from './assistive-technology';

describe('AssistiveTechnology (S3a cadence, A11Y-02)', () => {
    it('starts inactive, then follows what the OS reports', async () => {
        let notify: (active: boolean) => void = () => undefined;
        const tracker = new AssistiveTechnology({
            get: () => Promise.resolve(true),
            onChanged: (listener) => {
                notify = listener;
                return () => undefined;
            },
        });
        expect(tracker.active).toBe(false);
        await tracker.ready;
        expect(tracker.active).toBe(true);
        notify(false);
        expect(tracker.active).toBe(false);
    });
});

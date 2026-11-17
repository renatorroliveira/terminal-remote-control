import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { useNow } from './use-now';

function Clock() {
    return <output>{useNow(60_000)}</output>;
}

afterEach(() => {
    vi.useRealTimers();
});

describe('useNow', () => {
    it('reads the time again every interval, so a shown uptime stays current', async () => {
        vi.useFakeTimers({ now: 1_000, toFake: ['setInterval', 'clearInterval', 'Date'] });
        const screen = await render(<Clock />);
        await expect.element(screen.getByRole('status')).toHaveTextContent('1000');
        await vi.advanceTimersByTimeAsync(60_000);
        await expect.element(screen.getByRole('status')).toHaveTextContent('61000');
    });
});

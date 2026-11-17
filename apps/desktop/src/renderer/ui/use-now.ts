import { useEffect, useState } from 'react';

/** The time now, read again every `everyMs`, so text that counts the time since something stays current. */
export function useNow(everyMs: number): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), everyMs);
        return () => clearInterval(timer);
    }, [everyMs]);
    return now;
}

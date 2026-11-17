import type { DaemonDetails } from '@trc/protocol';

/**
 * A daemon's details with its start time on this computer's clock: received at `receivedAt`, after it had run
 * `uptimeMs`, so a host clock that is off does not skew the uptime shown (US-3.3.1). Older daemons say only when
 * they started by the host's clock, which is kept.
 */
export function onLocalClock(details: DaemonDetails, receivedAt: number): DaemonDetails {
    const { uptimeMs, ...rest } = details;
    return uptimeMs === undefined ? rest : { ...rest, startedAt: Math.max(0, receivedAt - uptimeMs) };
}

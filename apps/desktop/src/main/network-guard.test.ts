import { describe, expect, it } from 'vitest';
import {
    disableNetworkSwitches,
    type HostResolverOptions,
    lockDownNetwork,
    type NetworkLockTargets,
    WEBRTC_POLICY,
} from './network-guard';

interface Recorded {
    readonly targets: NetworkLockTargets;
    readonly resolver: HostResolverOptions[];
    readonly policies: string[];
    readonly page: () => void;
    readonly request: (permission: string) => boolean | undefined;
    readonly check: (permission: string) => boolean | undefined;
    readonly device: () => boolean | undefined;
}

function recorded(): Recorded {
    const resolver: HostResolverOptions[] = [];
    const policies: string[] = [];
    let created: ((contents: { setWebRTCIPHandlingPolicy(policy: string): void }) => void) | undefined;
    let request: ((permission: string, grant: (allowed: boolean) => void) => void) | undefined;
    let check: ((permission: string) => boolean) | undefined;
    let device: (() => boolean) | undefined;
    const targets: NetworkLockTargets = {
        configureHostResolver: (options) => resolver.push(options),
        onWebContentsCreated: (listener) => {
            created = listener;
        },
        denyPermissionRequests: (handler) => {
            request = handler;
        },
        denyPermissionChecks: (handler) => {
            check = handler;
        },
        denyDevicePermissions: (handler) => {
            device = handler;
        },
    };
    return {
        targets,
        resolver,
        policies,
        page: () => created?.({ setWebRTCIPHandlingPolicy: (policy) => policies.push(policy) }),
        request: (permission) => {
            let answer: boolean | undefined;
            request?.(permission, (allowed) => {
                answer = allowed;
            });
            return answer;
        },
        check: (permission) => check?.(permission),
        device: () => device?.(),
    };
}

describe('disableNetworkSwitches (SEC-01.1)', () => {
    it('turns QUIC off before Chromium starts, since it runs over UDP', () => {
        const switches: string[] = [];
        disableNetworkSwitches({ appendSwitch: (name) => switches.push(name) });
        expect(switches).toEqual(['disable-quic']);
    });
});

describe('lockDownNetwork (SEC-01.1, SEC-06)', () => {
    it('turns off Chromium’s own DNS client and DNS over HTTPS', () => {
        const lock = recorded();
        lockDownNetwork(lock.targets);
        expect(lock.resolver).toEqual([{ enableBuiltInResolver: false, secureDnsMode: 'off' }]);
    });

    it('keeps WebRTC off UDP on every page the app opens', () => {
        const lock = recorded();
        lockDownNetwork(lock.targets);
        lock.page();
        lock.page();
        expect(lock.policies).toEqual([WEBRTC_POLICY, WEBRTC_POLICY]);
        expect(WEBRTC_POLICY).toBe('disable_non_proxied_udp');
    });

    it('denies every permission request, check and device, which Electron would otherwise grant', () => {
        const lock = recorded();
        lockDownNetwork(lock.targets);
        expect(['media', 'clipboard-read', 'notifications', 'geolocation'].map((name) => lock.request(name))).toEqual([
            false,
            false,
            false,
            false,
        ]);
        expect(lock.check('clipboard-read')).toBe(false);
        expect(lock.device()).toBe(false);
    });
});

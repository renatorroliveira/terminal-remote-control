/**
 * Turns off the Chromium features that could open a socket the app never needs: QUIC, WebRTC over UDP, Chromium's
 * own DNS client and DNS over HTTPS. Every permission request, check and device request is denied too, since
 * Electron grants them by default and the app's pages use none (SEC-01.1, SEC-06).
 */

/** The WebRTC policy every page gets: no UDP, so ICE gathering opens no socket. */
export const WEBRTC_POLICY = 'disable_non_proxied_udp';

/** The host resolver settings the app runs with. */
export interface HostResolverOptions {
    readonly enableBuiltInResolver: false;
    readonly secureDnsMode: 'off';
}

/** Where the switches go: Chromium's command line, before the app is ready. */
export interface SwitchTarget {
    appendSwitch(name: string): void;
}

/** What the lock-down needs from Electron once the app is ready. */
export interface NetworkLockTargets {
    readonly configureHostResolver: (options: HostResolverOptions) => void;
    readonly onWebContentsCreated: (
        listener: (contents: { setWebRTCIPHandlingPolicy(policy: typeof WEBRTC_POLICY): void }) => void,
    ) => void;
    readonly denyPermissionRequests: (handler: (permission: string, grant: (allowed: boolean) => void) => void) => void;
    readonly denyPermissionChecks: (handler: (permission: string) => boolean) => void;
    readonly denyDevicePermissions: (handler: () => boolean) => void;
}

/** Appends the switches that must be set before Chromium starts: QUIC off, since it runs over UDP. */
export function disableNetworkSwitches(commandLine: SwitchTarget): void {
    commandLine.appendSwitch('disable-quic');
}

/** Once the app is ready: the DNS client and DNS over HTTPS off, WebRTC off UDP on every page, every permission denied. */
export function lockDownNetwork(targets: NetworkLockTargets): void {
    targets.configureHostResolver({ enableBuiltInResolver: false, secureDnsMode: 'off' });
    targets.onWebContentsCreated((contents) => contents.setWebRTCIPHandlingPolicy(WEBRTC_POLICY));
    targets.denyPermissionRequests((_permission, grant) => grant(false));
    targets.denyPermissionChecks(() => false);
    targets.denyDevicePermissions(() => false);
}

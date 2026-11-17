import { Button, Dialog, Heading, Input, Label, Modal, ModalOverlay, TextField } from 'react-aria-components';
import { useIntl } from 'react-intl';
import { useStore } from 'zustand';
import { isOlderVersion } from '../../shared/versions';
import type { Shell } from '../app/shell';
import { BUTTON, PRIMARY_BUTTON } from '../ui/buttons';
import styles from '../ui/dialog.module.css';
import { useNow } from '../ui/use-now';
import own from './DaemonDialogs.module.css';
import { detailsMessages, removeMessages } from './daemon-messages';
import { serviceText, uptimeText } from './daemon-text';
import { hostStateText } from './host-state-text';
import { persistenceFailureMessages } from './restore-messages';
import type { WorkspaceController } from './workspace-controller';
import { type HostEntry, hostGroups } from './workspace-model';

/** How often the shown uptime is brought up to date, as it shows whole minutes at most. */
const UPTIME_REFRESH_MS = 60_000;

/** What the daemon dialogs act on. */
export interface DaemonDialogsProps {
    readonly workspace: WorkspaceController;
    readonly shell: Shell;
}

/**
 * The dialogs about a host's daemon: its details, with Upgrade, Restart and Remove (US-3.3.1, US-3.3.2), and the
 * confirmation before Remove daemon from host, which lists the sessions that stop and the data deleted (US-3.3.3).
 */
export function DaemonDialogs(props: DaemonDialogsProps) {
    const dialog = useStore(props.shell.state, (state) => state.hostDialog);
    const host = useStore(props.workspace.store, (state) => state.hosts.find((entry) => entry.id === dialog?.hostId));
    const close = (): void => props.shell.setHostDialog(undefined);
    const kind = dialog?.kind === 'details' || dialog?.kind === 'remove-daemon' ? dialog.kind : undefined;
    return (
        <ModalOverlay
            isOpen={kind !== undefined && host !== undefined}
            onOpenChange={(open) => open || close()}
            className={styles['overlay'] ?? ''}
        >
            <Modal className={styles['modal'] ?? ''}>
                {host !== undefined && kind === 'details' && <DetailsDialog {...props} host={host} onClose={close} />}
                {host !== undefined && kind === 'remove-daemon' && (
                    <RemoveDialog {...props} host={host} onClose={close} />
                )}
            </Modal>
        </ModalOverlay>
    );
}

interface HostDialogProps extends DaemonDialogsProps {
    readonly host: HostEntry;
    readonly onClose: () => void;
}

function DetailsDialog({ host, shell, workspace, onClose }: HostDialogProps) {
    const intl = useIntl();
    const daemon = host.state.status === 'connected' ? host.state.daemon : undefined;
    const upgradable = daemon?.bundled !== undefined && isOlderVersion(daemon.version, daemon.bundled);
    const restart = (): void => {
        onClose();
        void shell.restartDaemon(host.id);
    };
    const upgrade = (): void => {
        onClose();
        workspace.upgradeDaemon(host.id);
    };
    return (
        <Dialog className={styles['dialog'] ?? ''}>
            <Heading slot="title" className={styles['heading'] ?? ''}>
                {intl.formatMessage(detailsMessages.title, { host: host.destination })}
            </Heading>
            <DaemonFacts host={host} workspace={workspace} />
            <LocationField label={intl.formatMessage(detailsMessages.installRoot)} value={daemonRoot(host)} autoFocus />
            {daemon?.details !== undefined && (
                <LocationField label={intl.formatMessage(detailsMessages.logs)} value={daemon.details.logDir} />
            )}
            {upgradable && (
                <p className={styles['hint']}>
                    {intl.formatMessage(detailsMessages.upgradeHint, { version: daemon.bundled ?? '' })}
                </p>
            )}
            <div className={styles['actions']}>
                {upgradable && (
                    <Button className={BUTTON} onPress={upgrade}>
                        {intl.formatMessage(detailsMessages.upgrade)}
                    </Button>
                )}
                {daemon !== undefined && daemon.proto >= 3 && (
                    <Button className={BUTTON} onPress={restart}>
                        {intl.formatMessage(detailsMessages.restart)}
                    </Button>
                )}
                <Button
                    className={BUTTON}
                    onPress={() => shell.setHostDialog({ kind: 'remove-daemon', hostId: host.id })}
                >
                    {intl.formatMessage(detailsMessages.remove)}
                </Button>
                <Button className={PRIMARY_BUTTON} onPress={onClose}>
                    {intl.formatMessage(detailsMessages.close)}
                </Button>
            </div>
        </Dialog>
    );
}

/**
 * The connection, what the connected daemon says about itself, and whether it fails to save some sessions'
 * scrollback (US-3.1.2); a host not connected says how to see more.
 */
function DaemonFacts({ host, workspace }: { readonly host: HostEntry; readonly workspace: WorkspaceController }) {
    const intl = useIntl();
    const now = useNow(UPTIME_REFRESH_MS);
    const failures = useStore(workspace.store, (state) => state.sessions.get(host.id) ?? []).flatMap((session) =>
        session.persistenceFailure === undefined ? [] : [session.persistenceFailure],
    );
    const daemon = host.state.status === 'connected' ? host.state.daemon : undefined;
    const saving =
        failures[0] === undefined
            ? []
            : [
                  [
                      intl.formatMessage(detailsMessages.saving),
                      intl.formatMessage(detailsMessages.savingFails, {
                          count: failures.length,
                          reason: intl.formatMessage(persistenceFailureMessages[failures[0]]),
                      }),
                  ] as const,
              ];
    const facts: (readonly [string, string])[] = [
        [intl.formatMessage(detailsMessages.connection), hostStateText(intl, host)],
        ...(daemon === undefined ? [] : [[intl.formatMessage(detailsMessages.version), daemon.version] as const]),
        ...(daemon?.details === undefined
            ? []
            : [[intl.formatMessage(detailsMessages.uptime), uptimeText(intl, daemon.details.startedAt, now)] as const]),
        ...(daemon?.service === undefined
            ? []
            : [[intl.formatMessage(detailsMessages.service), serviceText(intl, daemon.service)] as const]),
        ...saving,
    ];
    return (
        <>
            <dl className={own['facts']}>
                {facts.map(([term, value]) => (
                    <div key={term} className={own['fact']}>
                        <dt>{term}</dt>
                        <dd>{value}</dd>
                    </div>
                ))}
            </dl>
            {daemon === undefined && (
                <p className={styles['hint']}>{intl.formatMessage(detailsMessages.notConnected)}</p>
            )}
        </>
    );
}

/** A location the user can select and copy, as a read-only field (US-3.3.1). */
function LocationField(props: { readonly label: string; readonly value: string; readonly autoFocus?: boolean }) {
    return (
        <TextField isReadOnly value={props.value} className={styles['field'] ?? ''}>
            <Label>{props.label}</Label>
            <Input autoFocus={props.autoFocus === true} className={styles['input'] ?? ''} />
        </TextField>
    );
}

function RemoveDialog({ host, shell, workspace, onClose }: HostDialogProps) {
    const intl = useIntl();
    const state = useStore(workspace.store);
    const sessions = hostGroups(state).find((group) => group.host.id === host.id)?.sessions ?? [];
    const running = sessions.filter((item) => item.session.state === 'running' || item.session.state === 'starting');
    const remove = (): void => {
        onClose();
        void shell.removeDaemon(host.id);
    };
    return (
        <Dialog role="alertdialog" aria-describedby="trc-remove-data" className={styles['dialog'] ?? ''}>
            <Heading slot="title" className={styles['heading'] ?? ''}>
                {intl.formatMessage(removeMessages.title, { host: host.destination })}
            </Heading>
            <p className={styles['text']}>{intl.formatMessage(removeMessages.sessions, { count: running.length })}</p>
            {running.length > 0 && (
                <ul className={own['sessions']}>
                    {running.map((item) => (
                        <li key={item.key}>{item.label}</li>
                    ))}
                </ul>
            )}
            <p id="trc-remove-data" className={styles['text']}>
                {intl.formatMessage(removeMessages.data, { root: host.installRoot, host: host.destination })}
            </p>
            <div className={styles['actions']}>
                <Button autoFocus className={BUTTON} onPress={onClose}>
                    {intl.formatMessage(removeMessages.cancel)}
                </Button>
                <Button className={PRIMARY_BUTTON} onPress={remove}>
                    {intl.formatMessage(removeMessages.confirm)}
                </Button>
            </div>
        </Dialog>
    );
}

/** Where the daemon runs from: as the connected daemon says, else the host's install location. */
function daemonRoot(host: HostEntry): string {
    return host.state.status === 'connected'
        ? (host.state.daemon.details?.installRoot ?? host.installRoot)
        : host.installRoot;
}

import { useState } from 'react';
import { Button, Input, Label, TextField } from 'react-aria-components';
import { useStore } from 'zustand';
import { DEFAULT_INSTALL_ROOT, type WorkspaceController } from '../sessions/workspace-controller';
import styles from './TestHostForm.module.css';

const DEFAULT_DESTINATION = 'trc-ubuntu';

/**
 * Connects a host by name until ST-12's add-host dialog exists, and trusts host keys the user confirms. Only test
 * builds render it, so its strings are not localized.
 */
export function TestHostForm({ workspace }: { readonly workspace: WorkspaceController }) {
    const [destination, setDestination] = useState(DEFAULT_DESTINATION);
    const [installRoot, setInstallRoot] = useState(DEFAULT_INSTALL_ROOT);
    const hosts = useStore(workspace.store, (state) => state.hosts);

    return (
        <form
            aria-label="Test host"
            className={styles['form'] ?? ''}
            onSubmit={(event) => {
                event.preventDefault();
                workspace.connect(destination, installRoot);
            }}
        >
            <TextField value={destination} onChange={setDestination} isRequired className={styles['field'] ?? ''}>
                <Label>Destination</Label>
                <Input className={styles['input'] ?? ''} />
            </TextField>
            <TextField value={installRoot} onChange={setInstallRoot} isRequired className={styles['field'] ?? ''}>
                <Label>Install location</Label>
                <Input className={styles['input'] ?? ''} />
            </TextField>
            <Button type="submit" className={styles['button'] ?? ''}>
                Connect
            </Button>
            {hosts.map((host) =>
                host.state.status === 'host-key' ? (
                    <Button
                        key={host.id}
                        className={styles['button'] ?? ''}
                        onPress={() =>
                            host.state.status === 'host-key' &&
                            workspace.acceptHostKey(host.id, host.state.key.fingerprint)
                        }
                    >
                        {`Trust ${host.state.key.fingerprint} for ${host.destination}`}
                    </Button>
                ) : host.state.status === 'failed' ? (
                    <p key={host.id} className={styles['failure'] ?? ''}>
                        {`${host.destination}: ${host.state.failure.kind}. ${host.state.failure.details}`}
                    </p>
                ) : null,
            )}
        </form>
    );
}

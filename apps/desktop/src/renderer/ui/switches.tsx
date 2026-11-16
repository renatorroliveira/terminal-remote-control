import type { ReactNode } from 'react';
import { Switch, type SwitchProps } from 'react-aria-components';
import styles from './switch.module.css';

/** What a switch shows and does. */
export interface ToggleSwitchProps extends Omit<SwitchProps, 'children' | 'className'> {
    /** The visible label, which is also the switch's accessible name. */
    readonly children: ReactNode;
}

/**
 * An on/off control drawn as a track and a thumb beside its label: a native checkbox with the `switch` role, so AT
 * reports it as on or off and Space toggles it (A11Y-11).
 */
export function ToggleSwitch({ children, ...props }: ToggleSwitchProps) {
    return (
        <Switch {...props} className={styles['switch'] ?? ''}>
            <span className={styles['track']} aria-hidden="true" />
            {children}
        </Switch>
    );
}

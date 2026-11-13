import styles from './buttons.module.css';

/** The class names of a secondary button; its base styles have no specificity, so a component class can adjust them. */
export const BUTTON = styles['button'] ?? '';

/** The class names of a view's primary button. */
export const PRIMARY_BUTTON = `${BUTTON} ${styles['primary'] ?? ''}`;

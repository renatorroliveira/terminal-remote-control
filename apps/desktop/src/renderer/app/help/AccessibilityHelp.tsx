import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { useIntl } from 'react-intl';
import { useStore } from 'zustand';
import { BUTTON, PRIMARY_BUTTON } from '../../ui/buttons';
import type { Shell } from '../shell';
import { commandMessages } from '../shell-messages';
import styles from './AccessibilityHelp.module.css';
import { helpMessages } from './help-messages';
import { type HelpSection, helpSections } from './help-topics';

/** Whose help the dialog shows. */
export interface AccessibilityHelpProps {
    readonly shell: Shell;
}

/**
 * Accessibility help (A11Y-10.1): a dialog with one table of shortcuts for where help was asked for, one for those
 * that work everywhere, and the way to the user guide. Escape or Close returns focus to where it was.
 */
export function AccessibilityHelp({ shell }: AccessibilityHelpProps) {
    const intl = useIntl();
    const context = useStore(shell.state, (state) => state.help);
    const sections = context === undefined ? [] : helpSections(context, shell.keymap, intl);
    return (
        <ModalOverlay
            isOpen={context !== undefined}
            isDismissable
            onOpenChange={(open) => open || shell.closeHelp()}
            className={styles['overlay'] ?? ''}
        >
            <Modal className={styles['modal'] ?? ''}>
                <Dialog className={styles['dialog'] ?? ''}>
                    <Heading slot="title" className={styles['heading'] ?? ''}>
                        {intl.formatMessage(helpMessages.title)}
                    </Heading>
                    <p className={styles['text']}>{intl.formatMessage(helpMessages.intro)}</p>
                    {sections.map((section) => (
                        <HelpTable key={section.context} section={section} />
                    ))}
                    <h3 className={styles['subheading']}>{intl.formatMessage(helpMessages.documentation)}</h3>
                    <div className={styles['actions']}>
                        <Button className={BUTTON} onPress={() => shell.openGuide()}>
                            {intl.formatMessage(commandMessages['help.userGuide'])}
                        </Button>
                        <Button className={BUTTON} onPress={() => shell.openGuide('voiceover')}>
                            {intl.formatMessage(helpMessages.voiceOver)}
                        </Button>
                        <Button className={PRIMARY_BUTTON} onPress={() => shell.closeHelp()}>
                            {intl.formatMessage(helpMessages.close)}
                        </Button>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}

function HelpTable({ section }: { readonly section: HelpSection }) {
    const intl = useIntl();
    return (
        <table className={styles['table']}>
            <caption className={styles['caption']}>{section.title}</caption>
            <thead>
                <tr>
                    <th scope="col">{intl.formatMessage(helpMessages.action)}</th>
                    <th scope="col">{intl.formatMessage(helpMessages.keys)}</th>
                </tr>
            </thead>
            <tbody>
                {section.entries.map((entry) => (
                    <tr key={entry.action}>
                        <td>{entry.action}</td>
                        <td>
                            <kbd className={styles['keys']}>{entry.keys}</kbd>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

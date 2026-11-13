import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Button, FieldError, Input, Label, Text, TextField, ToggleButton } from 'react-aria-components';
import { type IntlShape, useIntl } from 'react-intl';
import { useStore } from 'zustand';
import { BUTTON } from '../ui/buttons';
import styles from './FindBar.module.css';
import { findBarMessages } from './find-messages';
import type { FindState, Shell } from './shell';

/** What the find bar acts on. */
export interface FindBarProps {
    readonly shell: Shell;
}

/**
 * Find in the terminal (US-1.13): a search field with case and regular expression options and the match count.
 * Return finds the previous match, Shift+Return the next, and Escape closes it and returns focus (US-1.13.4).
 */
export function FindBar({ shell }: FindBarProps) {
    const intl = useIntl();
    const find = useStore(shell.state, (state) => state.find);
    if (find === undefined) {
        return null;
    }
    const onFieldKey = (event: ReactKeyboardEvent | KeyboardEvent): void => {
        if (event.key === 'Enter') {
            event.preventDefault();
            shell.stepFind(event.shiftKey ? 'next' : 'previous');
        }
        closeOnEscape(event);
    };
    const closeOnEscape = (event: ReactKeyboardEvent | KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            shell.closeFind();
        }
    };
    return (
        <search aria-label={intl.formatMessage(findBarMessages.region)} className={styles['bar']}>
            <TextField
                value={find.query}
                onChange={(query) => shell.updateFind({ query })}
                isInvalid={find.result === 'invalid'}
                className={styles['field'] ?? ''}
            >
                <Label>{intl.formatMessage(findBarMessages.field)}</Label>
                <Input type="search" autoFocus onKeyDown={onFieldKey} className={styles['input'] ?? ''} />
                <Text slot="description" className={styles['hint']}>
                    {intl.formatMessage(findBarMessages.hint)}
                </Text>
                <FieldError className={styles['error'] ?? ''}>{intl.formatMessage(findBarMessages.invalid)}</FieldError>
            </TextField>
            <ToggleButton
                className={BUTTON}
                onKeyDown={closeOnEscape}
                isSelected={find.caseSensitive}
                onChange={(caseSensitive) => shell.updateFind({ caseSensitive })}
            >
                {intl.formatMessage(findBarMessages.matchCase)}
            </ToggleButton>
            <ToggleButton
                className={BUTTON}
                onKeyDown={closeOnEscape}
                isSelected={find.regex}
                onChange={(regex) => shell.updateFind({ regex })}
            >
                {intl.formatMessage(findBarMessages.regex)}
            </ToggleButton>
            <span className={styles['count']}>{countText(intl, find)}</span>
            <Button className={BUTTON} onKeyDown={closeOnEscape} onPress={() => shell.stepFind('previous')}>
                {intl.formatMessage(findBarMessages.previous)}
            </Button>
            <Button className={BUTTON} onKeyDown={closeOnEscape} onPress={() => shell.stepFind('next')}>
                {intl.formatMessage(findBarMessages.next)}
            </Button>
            <Button className={BUTTON} onPress={() => shell.closeFind()}>
                {intl.formatMessage(findBarMessages.close)}
            </Button>
        </search>
    );
}

function countText(intl: IntlShape, find: FindState): string {
    const result = find.result;
    if (result === undefined || result === 'invalid') {
        return '';
    }
    return result.count === 0
        ? intl.formatMessage(findBarMessages.none)
        : intl.formatMessage(findBarMessages.count, { index: result.index + 1, count: result.count });
}

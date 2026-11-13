import { useId } from 'react';
import { Button, Group, Input, Label, NumberField, Radio, RadioGroup, Switch, Text } from 'react-aria-components';
import styles from './SettingsDialog.module.css';

/** One choice of a {@link ChoiceSetting}. */
export interface Choice<T extends string | number> {
    readonly value: T;
    readonly label: string;
}

interface Described {
    readonly label: string;
    readonly description?: string | undefined;
}

/** A setting with a few choices, as radio buttons. */
export function ChoiceSetting<T extends string | number>(
    props: Described & {
        readonly value: T;
        readonly choices: readonly Choice<T>[];
        readonly onChange: (value: T) => void;
    },
) {
    const byKey = new Map(props.choices.map((choice) => [String(choice.value), choice.value]));
    return (
        <RadioGroup
            value={String(props.value)}
            onChange={(key) => {
                const value = byKey.get(key);
                if (value !== undefined) {
                    props.onChange(value);
                }
            }}
            className={styles['setting'] ?? ''}
        >
            <Label className={styles['label'] ?? ''}>{props.label}</Label>
            <div className={styles['choices']}>
                {props.choices.map((choice) => (
                    <Radio key={String(choice.value)} value={String(choice.value)} className={styles['radio'] ?? ''}>
                        {choice.label}
                    </Radio>
                ))}
            </div>
            {props.description !== undefined && (
                <Text slot="description" className={styles['description'] ?? ''}>
                    {props.description}
                </Text>
            )}
        </RadioGroup>
    );
}

/** A setting that is on or off, as a switch. */
export function SwitchSetting(
    props: Described & { readonly isSelected: boolean; readonly onChange: (on: boolean) => void },
) {
    const descriptionId = useId();
    const described = props.description === undefined ? {} : { 'aria-describedby': descriptionId };
    return (
        <div className={styles['setting']}>
            <Switch
                isSelected={props.isSelected}
                onChange={props.onChange}
                className={styles['switch'] ?? ''}
                {...described}
            >
                <span className={styles['track']} aria-hidden="true" />
                {props.label}
            </Switch>
            {props.description !== undefined && (
                <p id={descriptionId} className={styles['description']}>
                    {props.description}
                </p>
            )}
        </div>
    );
}

/** A numeric setting, as a spin button that keeps the value within its range. */
export function NumberSetting(
    props: Described & {
        readonly value: number;
        readonly min: number;
        readonly max: number;
        readonly step: number;
        readonly onChange: (value: number) => void;
    },
) {
    return (
        <NumberField
            value={props.value}
            minValue={props.min}
            maxValue={props.max}
            step={props.step}
            onChange={(value) => {
                if (Number.isFinite(value) && value !== props.value) {
                    props.onChange(value);
                }
            }}
            className={styles['setting'] ?? ''}
        >
            <Label className={styles['label'] ?? ''}>{props.label}</Label>
            <Group className={styles['number'] ?? ''}>
                <Button slot="decrement" className={styles['stepper'] ?? ''}>
                    −
                </Button>
                <Input className={styles['input'] ?? ''} />
                <Button slot="increment" className={styles['stepper'] ?? ''}>
                    +
                </Button>
            </Group>
            {props.description !== undefined && (
                <Text slot="description" className={styles['description'] ?? ''}>
                    {props.description}
                </Text>
            )}
        </NumberField>
    );
}

import { type BindingProblem, bindingProblem, type Chord, type CommandId } from '../../../shared/keymap';
import { keymapFor, type Settings } from '../../../shared/settings';

/** Why a shortcut cannot be kept: it breaks a rule, or another command owns it. */
export type ShortcutRefusal = { readonly problem: BindingProblem } | { readonly owner: CommandId };

/**
 * Why `chord` cannot become `command`'s shortcut under the current settings, or undefined when it can: a rule of
 * docs/design/keymap.md it breaks (A11Y-05.6), or the command that already has it, plain F6 included.
 */
export function shortcutRefusal(
    settings: Pick<Settings, 'shortcuts' | 'plainF6'>,
    command: CommandId,
    chord: Chord,
): ShortcutRefusal | undefined {
    const problem = bindingProblem(chord);
    if (problem !== undefined) {
        return { problem };
    }
    const owner = keymapFor(settings).commandFor(chord);
    return owner === undefined || owner === command ? undefined : { owner };
}

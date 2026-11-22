import {
    type BindingProblem,
    bindingProblem,
    type Chord,
    type CommandId,
    type KeymapPlatform,
} from '../../../shared/keymap';
import { keymapFor, type Settings } from '../../../shared/settings';

/** Why a shortcut cannot be kept: it breaks a rule, or another command owns it. */
export type ShortcutRefusal = { readonly problem: BindingProblem } | { readonly owner: CommandId };

/**
 * Why `chord` cannot become `command`'s shortcut under the current settings on `platform`, or undefined when it can:
 * a rule of docs/design/keymap.md it breaks (A11Y-05.6), or the command that already has it, plain F6 included.
 */
export function shortcutRefusal(
    settings: Pick<Settings, 'shortcuts' | 'plainF6'>,
    command: CommandId,
    chord: Chord,
    platform: KeymapPlatform = 'mac',
): ShortcutRefusal | undefined {
    const problem = bindingProblem(chord, platform);
    if (problem !== undefined) {
        return { problem };
    }
    const owner = keymapFor(settings, platform).commandFor(chord);
    return owner === undefined || owner === command ? undefined : { owner };
}

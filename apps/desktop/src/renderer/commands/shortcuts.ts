import { chordFromKey, type Keymap } from '../../shared/keymap';
import type { CommandRegistry } from './command-registry';

/** What the shortcut dispatcher needs. */
export interface ShortcutOptions {
    /** The keymap in force now, which rebinding changes. */
    readonly keymap: () => Keymap;
    readonly commands: Pick<CommandRegistry, 'run'>;
    /** Whether the terminal asked for the next key, even an app shortcut (A11Y-05.3). */
    readonly passNextKey: () => boolean;
    /** Whether a modal dialog owns the keyboard. */
    readonly blocked: () => boolean;
}

/**
 * Matches every key press against the keymap before the focused element sees it, and runs the bound command
 * (docs/design/keymap.md, rule 7). A key the terminal asked for, a key pressed while a modal dialog is open, and any
 * key no registered command is bound to go on to the focused element. Returns the uninstaller.
 */
export function installShortcuts(target: Window, options: ShortcutOptions): () => void {
    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.isComposing || options.passNextKey() || options.blocked()) {
            return;
        }
        const chord = chordFromKey(event);
        const command = chord === undefined ? undefined : options.keymap().commandFor(chord);
        if (command !== undefined && options.commands.run(command)) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    };
    target.addEventListener('keydown', onKeyDown, { capture: true });
    return () => target.removeEventListener('keydown', onKeyDown, { capture: true });
}

import type { CommandId } from '../../shared/keymap';

/** A command the keymap, the menus and the command palette run. */
export interface Command {
    readonly id: CommandId;
    /** The command's name in the palette and in accessibility help. */
    readonly label: string;
    run(): void;
}

/** Every command the app has registered, by ID. */
export class CommandRegistry {
    readonly #commands = new Map<CommandId, Command>();

    /** Adds a command, replacing any with the same ID. */
    register(command: Command): void {
        this.#commands.set(command.id, command);
    }

    /** Runs a command; false when no command has that ID. */
    run(id: CommandId): boolean {
        const command = this.#commands.get(id);
        command?.run();
        return command !== undefined;
    }

    /** Every command, in the order it was first registered. */
    list(): readonly Command[] {
        return [...this.#commands.values()];
    }
}

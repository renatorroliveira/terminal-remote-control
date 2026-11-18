import type { SessionInfo, ShellKind } from '@trc/protocol';
import type { IntlShape, MessageDescriptor } from 'react-intl';
import type { CommandId } from '../../shared/keymap';
import type { Settings } from '../../shared/settings';
import { type SessionKey, sessionKey, type Workspace } from '../sessions/workspace-model';
import { SELECTION_CAP } from '../terminal/ats-surface';
import type { CommandDirection, CommandMove, CommandOutput } from '../terminal/command-navigator';
import type { Announcer } from './announcer';
import { commandAnnouncements as messages } from './command-messages';
import type { AudioCue } from './sound/audio-cues';

/** The most lines of output Read last command output speaks; select or copy it for the rest (US-5.2.1). */
export const READ_LINES = 100;
/** The shortest time between two cues for one session's finished commands, so forged marks can't drone (SEC-06). */
export const CUE_INTERVAL_MS = 1_000;

const INTEGRATED_KINDS: ReadonlySet<ShellKind> = new Set(['bash', 'zsh', 'fish']);

/** What command navigation asks of the open terminal; undefined when no session is open. */
export interface CommandTerminals {
    commandStep(direction: CommandDirection): CommandMove | undefined;
    lastCommandOutput(): CommandOutput | undefined;
    selectLastCommandOutput(): CommandOutput | undefined;
}

/** The settings that decide what a finished command does (US-5.2.2). */
export type CommandSettings = Pick<Settings, 'announceFailedCommands' | 'commandSucceededCue' | 'commandFailedCue'>;

/** What command navigation is built from. */
export interface CommandActionsOptions {
    readonly terminals: CommandTerminals;
    readonly workspace: () => Workspace;
    readonly intl: IntlShape;
    readonly announcer: Pick<Announcer, 'announce'>;
    readonly playCue: (cue: AudioCue) => void;
    readonly settings: () => CommandSettings;
    /** Puts text on the clipboard; false when it could not. */
    readonly copy: (text: string) => Promise<boolean>;
    /** Says that no session is open. */
    readonly noSession: () => void;
    /** Shows a finished command's result, the visual equivalent of its cue (A11Y-12.4). */
    readonly showResult?: (key: SessionKey, exitCode: number) => void;
    /** The clock cues are paced by. */
    readonly now?: () => number;
}

/**
 * Command navigation's commands (US-5.2.1) and what a command finishing in the open session announces and plays
 * (US-5.2.2). When no command is marked, each command says why (US-5.2.3): shell integration is off for the host,
 * the shell has none, the shell started without it, or no command has run yet.
 */
export class CommandActions {
    readonly #options: CommandActionsOptions;
    readonly #lastCue = new Map<SessionKey, number>();

    /** Command navigation over `options`. */
    constructor(options: CommandActionsOptions) {
        this.#options = options;
    }

    /** The commands it runs, by ID. */
    actions(): Readonly<Partial<Record<CommandId, () => void>>> {
        return {
            'command.previous': () => this.#step('previous'),
            'command.next': () => this.#step('next'),
            'command.readOutput': () => this.#read(),
            'command.selectOutput': () => this.#select(),
            'command.copyOutput': () => void this.#copy(),
        };
    }

    /**
     * A command finished in a session's terminal. In the open session, a failure is announced after the output
     * already queued, and the success or failure cue plays, each as the settings say; other sessions are left to
     * background events (US-5.3).
     */
    finished(key: SessionKey, exitCode: number | undefined): void {
        if (key !== this.#options.workspace().open || exitCode === undefined) {
            return;
        }
        const settings = this.#options.settings();
        const failed = exitCode !== 0;
        if (failed && settings.announceFailedCommands) {
            this.#announce(this.#options.intl.formatMessage(messages.failed, { code: exitCode }), `failed:${key}`);
        }
        this.#options.showResult?.(key, exitCode);
        if ((failed ? settings.commandFailedCue : settings.commandSucceededCue) && this.#cueDue(key)) {
            this.#options.playCue(failed ? 'command-failed' : 'command-succeeded');
        }
    }

    #cueDue(key: SessionKey): boolean {
        const now = this.#options.now?.() ?? Date.now();
        if (now - (this.#lastCue.get(key) ?? Number.NEGATIVE_INFINITY) < CUE_INTERVAL_MS) {
            return false;
        }
        this.#lastCue.set(key, now);
        return true;
    }

    #step(direction: CommandDirection): void {
        const move = this.#options.terminals.commandStep(direction);
        if (move === undefined) {
            this.#options.noSession();
            return;
        }
        this.#announce(this.#moveText(move), 'command');
    }

    #read(): void {
        const output = this.#options.terminals.lastCommandOutput();
        if (output === undefined) {
            this.#options.noSession();
            return;
        }
        this.#announce(
            output.kind === 'output' ? this.#outputText(output.text, output.lines) : this.#refusal(output.reason),
            'command',
        );
    }

    #select(): void {
        const output = this.#options.terminals.selectLastCommandOutput();
        if (output === undefined) {
            this.#options.noSession();
            return;
        }
        const capped = output.kind === 'output' && output.lines > SELECTION_CAP;
        this.#announce(
            capped
                ? this.#options.intl.formatMessage(messages.selectedCapped, { lines: output.lines, cap: SELECTION_CAP })
                : this.#countText(output, messages.selected),
            'command',
        );
    }

    async #copy(): Promise<void> {
        const output = this.#options.terminals.lastCommandOutput();
        if (output === undefined) {
            this.#options.noSession();
            return;
        }
        const copied = output.kind !== 'output' || output.lines === 0 || (await this.#options.copy(output.text));
        this.#announce(
            copied ? this.#countText(output, messages.copied) : this.#options.intl.formatMessage(messages.copyFailed),
            'command',
        );
    }

    #moveText(move: CommandMove): string {
        const { intl } = this.#options;
        switch (move.kind) {
            case 'moved':
                if (move.running) {
                    return intl.formatMessage(messages.movedRunning, { line: move.line });
                }
                return move.exitCode !== undefined && move.exitCode !== 0
                    ? intl.formatMessage(messages.movedFailed, { line: move.line, code: move.exitCode })
                    : intl.formatMessage(messages.moved, { line: move.line });
            case 'edge':
                return intl.formatMessage(move.direction === 'previous' ? messages.firstCommand : messages.lastCommand);
            case 'unavailable':
                return this.#refusal(move.reason);
        }
    }

    #outputText(text: string, lines: number): string {
        const { intl } = this.#options;
        if (lines === 0) {
            return intl.formatMessage(messages.outputEmpty);
        }
        if (lines <= READ_LINES) {
            return intl.formatMessage(messages.output, { text });
        }
        const tail = text.split('\n').slice(-READ_LINES).join('\n');
        return intl.formatMessage(messages.outputTail, { shown: READ_LINES, lines, text: tail });
    }

    #countText(output: CommandOutput, done: MessageDescriptor): string {
        const { intl } = this.#options;
        if (output.kind === 'unavailable') {
            return this.#refusal(output.reason);
        }
        return output.lines === 0
            ? intl.formatMessage(messages.outputEmpty)
            : intl.formatMessage(done, { lines: output.lines });
    }

    #refusal(reason: 'none' | 'full-screen'): string {
        const { intl } = this.#options;
        if (reason === 'full-screen') {
            return intl.formatMessage(messages.fullScreen);
        }
        const open = this.#openSession();
        switch (open?.session.integration) {
            case 'off':
                return intl.formatMessage(messages.integrationOff, { host: open.host });
            case 'unsupported':
                return INTEGRATED_KINDS.has(open.session.profile.kind)
                    ? intl.formatMessage(messages.integrationArguments, { shell: open.session.profile.name })
                    : intl.formatMessage(messages.integrationUnsupported, { shell: open.session.profile.name });
            case 'injected':
            case 'native':
                return intl.formatMessage(messages.noCommandYet);
            default:
                return intl.formatMessage(messages.integrationMissing);
        }
    }

    #openSession(): { readonly host: string; readonly session: SessionInfo } | undefined {
        const workspace = this.#options.workspace();
        for (const host of workspace.hosts) {
            const session = workspace.sessions
                .get(host.id)
                ?.find((entry) => sessionKey(host.id, entry.id) === workspace.open);
            if (session !== undefined) {
                return { host: host.destination, session };
            }
        }
        return undefined;
    }

    #announce(text: string, group: string): void {
        this.#options.announcer.announce(text, { group });
    }
}

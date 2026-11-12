import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import type { HelperLine } from '../ssh/helper-lines';
import { parseHelperLine } from '../ssh/helper-lines';

/** A running `ssh` for one connection. */
export interface SshProcess {
    readonly child: ChildProcessWithoutNullStreams;
    /** ssh's stderr lines so far, kept for classifying a failure. */
    readonly stderr: readonly string[];
    /** Resolves with the exit code once ssh has exited. */
    readonly exited: Promise<number | null>;
}

/** How many stderr lines are kept; ssh's messages are short, so this bounds memory without losing a diagnosis. */
const KEPT_STDERR_LINES = 500;

/** How to start ssh. */
export interface SshLaunch {
    readonly program: string;
    readonly args: readonly string[];
    readonly env: Readonly<Record<string, string>>;
    /** The helpers' nonce. */
    readonly nonce: string;
    /** Called with each helper line as it arrives. */
    readonly onHelper: (line: HelperLine) => void;
}

/** Starts ssh, splitting its stderr into lines and reporting the app helpers' lines as they arrive. */
export function startSsh({ program, args, env, nonce, onHelper }: SshLaunch): SshProcess {
    const child = spawn(program, [...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const stderr: string[] = [];
    let partial = '';
    child.stdin.on('error', () => undefined);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
        const lines = `${partial}${chunk}`.split('\n');
        partial = lines.pop() ?? '';
        for (const line of lines) {
            if (stderr.length < KEPT_STDERR_LINES) {
                stderr.push(line);
            }
            const helper = parseHelperLine(line.replace(/\r$/, ''), nonce);
            if (helper !== undefined) {
                onHelper(helper);
            }
        }
    });
    const exited = new Promise<number | null>((resolve) => {
        child.on('close', (code) => {
            if (partial !== '') {
                stderr.push(partial);
            }
            resolve(code);
        });
        child.on('error', () => resolve(null));
    });
    return { child, stderr, exited };
}

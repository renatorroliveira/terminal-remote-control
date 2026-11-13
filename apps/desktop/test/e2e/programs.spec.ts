import { expect, type Locator, type Page, test } from '@playwright/test';
import {
    launchWithTestHosts,
    openTerminal,
    removeInstall,
    rowTexts,
    scratchInstallRoot,
    type TestHostApp,
    testHostsMissing,
} from './support/test-host';

const missing = testHostsMissing();
const PROMPT = 'trc-ready$';

interface Shared {
    launched?: TestHostApp;
    terminal?: Locator;
    root: string;
}

const shared: Shared = { root: '' };

function window(): Page {
    if (shared.launched === undefined) {
        throw new Error('the app is not running');
    }
    return shared.launched.window;
}

async function screen(): Promise<string> {
    if (shared.terminal === undefined) {
        throw new Error('no terminal');
    }
    return (await rowTexts(shared.terminal)).join('\n');
}

/** Waits until the visible screen matches `pattern`. */
async function shows(pattern: RegExp, timeout = 15_000): Promise<void> {
    await expect.poll(screen, { timeout }).toMatch(pattern);
}

/** Types a command line and presses Return. */
async function run(command: string): Promise<void> {
    await window().keyboard.type(command);
    await window().keyboard.press('Enter');
}

/** Clears the screen and waits for a fresh prompt, so the next check sees only the next program. */
async function freshPrompt(): Promise<void> {
    await run('clear');
    await shows(new RegExp(`^\\s*${PROMPT.replace('$', '\\$')}\\s*$`, 'm'));
}

/** Leaves a marker on the main screen, so a full-screen program can be seen to restore it on exit. */
async function marker(name: string): Promise<string> {
    const text = `trc-before-${name}`;
    await run(`echo ${text}`);
    await shows(new RegExp(`^${text}$`, 'm'));
    return text;
}

test.describe.serial('the program matrix on a Linux host (US-1.11.5)', () => {
    test.skip(missing !== undefined, missing);

    test.beforeAll(async () => {
        shared.root = scratchInstallRoot();
        shared.launched = await launchWithTestHosts(shared.root);
        shared.terminal = await openTerminal(shared.launched.window, 'trc-ubuntu');
        await shared.terminal.focus();
        await shows(/[$#] *$/m, 30_000);
        await run(`PS1='${PROMPT} '`);
        await freshPrompt();
    });

    test.afterAll(async () => {
        await shared.launched?.app.close();
        removeInstall('trc-ubuntu', shared.root);
    });

    test('vim edits a file in the alternate screen and restores the shell screen', async () => {
        const before = await marker('vim');
        await run('rm -f /tmp/trc-vim.txt; vim -u NONE -N /tmp/trc-vim.txt');
        await shows(/^~/m);
        await window().keyboard.type('itrc-vim-ok');
        await window().keyboard.press('Escape');
        await run(':wq');
        await shows(new RegExp(`^${before}$`, 'm'));
        await run('cat /tmp/trc-vim.txt');
        await shows(/^trc-vim-ok$/m);
        await freshPrompt();
    });

    test('neovim edits a file the same way', async () => {
        const before = await marker('nvim');
        await run('rm -f /tmp/trc-nvim.txt; nvim --clean /tmp/trc-nvim.txt');
        await shows(/^~/m);
        await shows(/trc-nvim\.txt/);
        await window().keyboard.type('itrc-nvim-ok');
        await shows(/^trc-nvim-ok/m);
        await window().keyboard.press('Escape');
        await run(':wq');
        await shows(new RegExp(`^${before}$`, 'm'));
        await run('cat /tmp/trc-nvim.txt');
        await shows(/^trc-nvim-ok$/m);
        await freshPrompt();
    });

    test('less pages output, jumps to the end and quits', async () => {
        const before = await marker('less');
        await run('seq 1 500 | less');
        await shows(/^1$/m);
        await window().keyboard.press('G');
        await shows(/^500$/m);
        await window().keyboard.press('q');
        await shows(new RegExp(`^${before}$`, 'm'));
        await freshPrompt();
    });

    test('top shows the process table and quits', async () => {
        await run('top');
        await shows(/load average/);
        await shows(/PID\s+USER/);
        await window().keyboard.press('q');
        await freshPrompt();
    });

    test('htop draws its meters and quits', async () => {
        await run('htop');
        await shows(/Mem\[/, 20_000);
        await shows(/F10Quit/);
        await window().keyboard.press('q');
        await freshPrompt();
    });

    test('tmux runs inside tmux, each with its own status line', async () => {
        await run('tmux -L trc-inner kill-server; tmux -L trc-outer kill-server; clear');
        await run('tmux -L trc-outer new-session -s outer');
        await shows(/\[outer\]/);
        await run('env -u TMUX tmux -L trc-inner new-session -s inner');
        await shows(/\[inner\]/);
        await shows(/\[outer\]/);
        await run('tmux -L trc-inner kill-server');
        await expect.poll(screen, { timeout: 15_000 }).not.toMatch(/\[inner\]/);
        await shows(/\[outer\]/);
        await run('tmux -L trc-outer kill-server');
        await expect.poll(screen, { timeout: 15_000 }).not.toMatch(/\[outer\]/);
        await freshPrompt();
    });

    test('git commits and shows its log through its pager', async () => {
        await run('rm -rf /tmp/trc-git && git init -q /tmp/trc-git && cd /tmp/trc-git');
        await run('git -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m trc-git-ok');
        await run('git log');
        await shows(/trc-git-ok/);
        await window().keyboard.press('q');
        await run('cd');
        await freshPrompt();
    });

    test('ssh opens a nested login on the same host and returns', async () => {
        await run(
            "test -f ~/.ssh/trc-nested || ssh-keygen -q -t ed25519 -N '' -f ~/.ssh/trc-nested && cat ~/.ssh/trc-nested.pub >> ~/.ssh/authorized_keys",
        );
        await run(
            'ssh -i ~/.ssh/trc-nested -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/tmp/trc-kh localhost',
        );
        await shows(/Welcome to the trc test host/, 20_000);
        await run('echo "nested-$SSH_CONNECTION" | cut -c1-16');
        await shows(/^nested-(::1|127\.0\.0\.1) /m);
        await run('exit');
        await shows(/Connection to localhost closed/);
        await freshPrompt();
    });

    test('the Python REPL evaluates and exits', async () => {
        await run('python3 -q');
        await shows(/^>>> ?$/m);
        await run('6 * 7');
        await shows(/^42$/m);
        await run('exit()');
        await freshPrompt();
    });
});

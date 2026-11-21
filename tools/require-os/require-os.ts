/**
 * Stops a package script on the wrong OS with a clear message instead of a missing-tool error halfway through, for
 * the macOS-only `*:mac` scripts (E6). Run as `node tools/require-os/require-os.ts <platform> <script>`, where
 * `<platform>` is a Node `process.platform` value.
 */

/** The message for running `script` on `actual` when it needs `required`, or `undefined` when they match. */
export function wrongOsMessage(script: string, required: string, actual: string): string | undefined {
    return required === actual ? undefined : `${script} runs only on ${required}; this is ${actual}\n`;
}

if (import.meta.main) {
    const [required = '', script = 'this script'] = process.argv.slice(2);
    const message = wrongOsMessage(script, required, process.platform);
    if (message !== undefined) {
        process.stderr.write(message);
        process.exitCode = 1;
    }
}

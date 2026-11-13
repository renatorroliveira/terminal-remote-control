/** Something a terminal reports for the shell to show or announce. */
export type TerminalNotice =
    /** A copy took more lines than the OS sees selected (A11Y-04.7). */
    | { readonly kind: 'copy-capped'; readonly lines: number }
    /** A program on a host that allows it wrote the clipboard (SEC-06.1). */
    | { readonly kind: 'clipboard-written' };

/** Something a terminal reports for the shell to show or announce. */
export type TerminalNotice =
    /** A copy took more lines than the OS sees selected (A11Y-04.7). */
    | { readonly kind: 'copy-capped'; readonly lines: number }
    /** A program on a host that allows it wrote the clipboard (SEC-06.1). */
    | { readonly kind: 'clipboard-written' }
    /** The program rang the bell (A11Y-08.2). */
    | { readonly kind: 'bell' }
    /** Output arrived below a viewport the user scrolled back (A11Y-08.4). */
    | { readonly kind: 'output-below' }
    /** Output arrived while review mode was open (A11Y-03.5). */
    | { readonly kind: 'review-output' }
    /** The user typed while the host was disconnected; nothing was sent (US-1.14.2). */
    | { readonly kind: 'input-refused' };

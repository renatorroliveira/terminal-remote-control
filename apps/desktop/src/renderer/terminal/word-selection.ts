/**
 * Pulls the end of a word a double-click selected back over the whitespace after it, which Chromium selects on Windows,
 * so the word is copied and read alone, as in Windows Terminal and on macOS (A11Y-04.1, D-67). A selection of nothing
 * but whitespace is left as it is.
 */
export function trimTrailingSpace(selection: Selection): void {
    const focus = selection.focusNode;
    if (selection.isCollapsed || !(focus instanceof Text) || !forward(selection)) {
        return;
    }
    const before = focus.data.slice(0, selection.focusOffset);
    const trailing = before.length - before.trimEnd().length;
    if (trailing === 0 || selection.toString().trim() === '') {
        return;
    }
    selection.extend(focus, selection.focusOffset - trailing);
}

function forward(selection: Selection): boolean {
    const { anchorNode, focusNode } = selection;
    if (anchorNode === null || focusNode === null) {
        return false;
    }
    if (anchorNode === focusNode) {
        return selection.anchorOffset < selection.focusOffset;
    }
    return (anchorNode.compareDocumentPosition(focusNode) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

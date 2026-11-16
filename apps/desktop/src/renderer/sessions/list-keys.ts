/** The next row after `index` with a label that starts with `prefix`, wrapping around (US-1.6.4, P-48). */
export function typeAhead(labels: readonly (readonly string[])[], index: number, prefix: string): number | undefined {
    const wanted = prefix.toLocaleLowerCase();
    for (let step = 1; step <= labels.length; step += 1) {
        const candidate = (index + step) % labels.length;
        if (labels[candidate]?.some((label) => label.toLocaleLowerCase().startsWith(wanted)) === true) {
            return candidate;
        }
    }
    return undefined;
}

/** The next label after `index` that starts with `prefix`, wrapping around (US-1.6.4). */
export function typeAhead(labels: readonly string[], index: number, prefix: string): number | undefined {
    const wanted = prefix.toLocaleLowerCase();
    for (let step = 1; step <= labels.length; step += 1) {
        const candidate = (index + step) % labels.length;
        if (labels[candidate]?.toLocaleLowerCase().startsWith(wanted) === true) {
            return candidate;
        }
    }
    return undefined;
}

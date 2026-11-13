const SUBJECT = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/;
const SECTIONS = [
    { title: 'Features', types: ['feat'] },
    { title: 'Fixes', types: ['fix'] },
] as const;

interface Change {
    readonly type: string;
    readonly line: string;
}

/**
 * Release notes from Conventional Commit subjects (newest first): features, fixes, then every other change, each
 * line with its scope in bold. The release commits themselves (`chore(release)`) are left out.
 */
export function releaseNotes(version: string, subjects: readonly string[]): string {
    const changes = subjects.flatMap((subject) => parse(subject) ?? []);
    const known = SECTIONS.flatMap((section) => section.types) as readonly string[];
    const groups = [
        ...SECTIONS.map((section) => ({
            title: section.title,
            lines: changes.filter((change) => (section.types as readonly string[]).includes(change.type)),
        })),
        { title: 'Other changes', lines: changes.filter((change) => !known.includes(change.type)) },
    ].filter((group) => group.lines.length > 0);
    const body = groups.flatMap((group) => [`## ${group.title}`, '', ...group.lines.map((change) => change.line), '']);
    return [`# Terminal Remote Control ${version}`, '', ...body].join('\n');
}

function parse(subject: string): Change | undefined {
    const parts = SUBJECT.exec(subject.trim());
    if (parts === null || (parts[1] === 'chore' && parts[2] === 'release')) {
        return undefined;
    }
    const [, type = '', scope, breaking, description = ''] = parts;
    const prefix = scope === undefined ? '' : `**${scope}:** `;
    return { type, line: `- ${prefix}${description}${breaking === undefined ? '' : ' (breaking)'}` };
}

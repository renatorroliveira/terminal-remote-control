import { stripControlCharacters } from '../../shared/text';

const HOME_MARK = '~';
const SHOWN_FOLDERS = 2;

/**
 * Where a session is, as its list item shows it before its name (P-48): the last two folders of its working
 * directory, with the home folder as `~` counted as one folder. A path that fits in two folders shows whole, from
 * `/` or `~`; none shows without an absolute working directory.
 */
export function sessionPlace(cwd: string | undefined, home: string | undefined): string | undefined {
    if (cwd === undefined || !cwd.startsWith('/')) {
        return undefined;
    }
    const folders = foldersOf(cwd);
    const homeFolders = home === undefined ? [] : foldersOf(home);
    const inHome = homeFolders.length > 0 && homeFolders.every((folder, index) => folders[index] === folder);
    const shown = inHome ? [HOME_MARK, ...folders.slice(homeFolders.length)] : folders;
    if (shown.length > SHOWN_FOLDERS) {
        return stripControlCharacters(shown.slice(-SHOWN_FOLDERS).join('/'));
    }
    return stripControlCharacters(inHome ? shown.join('/') : `/${shown.join('/')}`);
}

function foldersOf(path: string): readonly string[] {
    return path.split('/').filter((folder) => folder !== '');
}

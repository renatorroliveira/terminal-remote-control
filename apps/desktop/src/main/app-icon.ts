import { join } from 'node:path';

/** The app icon the window (Windows, Linux) and the development dock (macOS) show, rendered by `pnpm icons:mac`. */
export function appIconPath(resources: string): string {
    return join(resources, 'icons', 'icon.png');
}

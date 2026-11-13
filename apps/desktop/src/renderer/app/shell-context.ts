import { createContext, useContext } from 'react';
import type { Shell } from './shell';

/** The shell, for components deep in the sidebar that open its dialogs or announce through it. */
export const ShellContext = createContext<Shell | undefined>(undefined);

/** The shell the app runs in, when there is one; components rendered alone in tests have none. */
export function useShell(): Shell | undefined {
    return useContext(ShellContext);
}

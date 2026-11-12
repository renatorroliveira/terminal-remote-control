import type { IDisposable, Terminal } from '@xterm/xterm';

const SWALLOW = (): boolean => true;
const OSC_COLOR_QUERIES = [4, 10, 11, 12, 17, 19];

/**
 * Swallows terminal queries in the renderer, because the daemon's emulator already answers them; a second answer
 * would reach the program twice (TECH_STACK §4.3). OSC 52 is swallowed too: clipboard access is off (SEC-06.1).
 */
export function registerQueryFilters(terminal: Terminal): IDisposable[] {
    const { parser } = terminal;
    return [
        parser.registerCsiHandler({ final: 'c' }, SWALLOW),
        parser.registerCsiHandler({ prefix: '>', final: 'c' }, SWALLOW),
        parser.registerCsiHandler({ prefix: '=', final: 'c' }, SWALLOW),
        parser.registerCsiHandler({ final: 'n' }, SWALLOW),
        parser.registerCsiHandler({ prefix: '?', final: 'n' }, SWALLOW),
        parser.registerCsiHandler({ prefix: '>', final: 'q' }, SWALLOW),
        parser.registerCsiHandler({ intermediates: '$', final: 'p' }, SWALLOW),
        parser.registerCsiHandler({ prefix: '?', intermediates: '$', final: 'p' }, SWALLOW),
        parser.registerCsiHandler({ prefix: '?', final: 'u' }, SWALLOW),
        parser.registerDcsHandler({ intermediates: '$', final: 'q' }, SWALLOW),
        parser.registerDcsHandler({ intermediates: '+', final: 'q' }, SWALLOW),
        ...OSC_COLOR_QUERIES.map((ident) => parser.registerOscHandler(ident, (data) => data.split(';').includes('?'))),
        parser.registerOscHandler(52, SWALLOW),
    ];
}

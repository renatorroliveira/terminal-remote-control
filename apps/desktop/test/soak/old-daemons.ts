import { homedir } from 'node:os';
import { join } from 'node:path';

/** Where the 0.2.0 release's daemons are kept, as `tools/test-hosts/fetch-old-daemon.sh` puts them. */
export const OLD_DAEMONS = join(
    process.env['TRC_CACHE_DIR'] ?? join(process.env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache'), 'trc'),
    'daemon',
    '0.2.0',
);

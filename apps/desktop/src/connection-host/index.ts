/**
 * Connection host entry: an Electron utilityProcess that will own every ssh child and daemon connection (ST-8).
 */
process.parentPort?.on('message', () => undefined);

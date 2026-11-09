import { sdk } from './sdk'

// /db is the DuckDB tweak index and its start-height record: large, and rebuilt by re-indexing.
// /recentblocks holds the last indexed blocks' hashes, and /rebuild.request a pending rebuild: both
// belong to that index, so a restored new index must not inherit them.
// frigate.log is an unrotated FileAppender; StartOS captures the same lines from stdout.
export const { createBackup, restoreInit } = sdk.setupBackups(async () =>
  sdk.Backups.ofVolumes('main').setOptions({
    exclude: ['/db', '/frigate.log', '/recentblocks', '/rebuild.request'],
  }),
)

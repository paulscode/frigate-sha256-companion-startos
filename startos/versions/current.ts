import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '1.6.1:1',
  releaseNotes: {
    en_US:
      'Stop, updates and restarts can no longer be held up by a status check that never finishes: a check still unanswered after a minute says so, and no longer keeps the service from stopping. From 1.6.1:0: first release. Frigate 1.6.1 for a pruned node, on the SHA256 or the BLAKE2b chain: no txindex needed, Electrum protocol 1.8 on the BLAKE2b chain, and Electrs Pruned or Fulcrum Pruned (or, with an archival node, Electrs or Fulcrum) as its indexer. Look Back for Payments (in Configure Frigate, off by default) finds Silent Payments in blocks the pruned node has already discarded, fetching them from peers.',
  },
  migrations: {
    up: async () => {},
    down: IMPOSSIBLE,
  },
})

import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '1.6.1:0',
  releaseNotes: {
    en_US:
      'First release. Frigate 1.6.1 for a pruned node, on the SHA256 or the BLAKE2b chain: no txindex needed, Electrum protocol 1.8 on the BLAKE2b chain, and Electrs Pruned or Fulcrum Pruned as its indexer. Look Back for Payments (in Configure Frigate, off by default) finds Silent Payments in blocks the pruned node has already discarded, fetching them from peers.',
  },
  migrations: {
    up: async () => {},
    down: IMPOSSIBLE,
  },
})

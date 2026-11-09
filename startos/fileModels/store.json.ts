import { FileHelper, z } from '@start9labs/start-sdk'
import { indexerIds, IndexerId } from '../indexers'
import { nodeIds, NodeId } from '../nodes'
import { sdk } from '../sdk'

/**
 * StartOS-side state, beside Frigate's own config.toml:
 *   - node, indexer: the Select Node and Select Indexer choices (null until made).
 * A pending Rebuild Index is a marker file instead (utils.ts, rebuildRequest).
 */
const shape = z.object({
  node: z
    .enum(nodeIds as [NodeId, ...NodeId[]])
    .nullable()
    .catch(null),
  indexer: z
    .enum(indexerIds as [IndexerId, ...IndexerId[]])
    .nullable()
    .catch(null),
})

export const storeJson = FileHelper.json(
  { base: sdk.volumes.main, subpath: '/store.json' },
  shape,
)

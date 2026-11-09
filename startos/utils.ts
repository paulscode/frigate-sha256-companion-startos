import { sdk } from './sdk'

// Host id Frigate binds its Electrum interface on, and the container port it listens on.
export const electrumHostId = 'electrum'
export const electrumPort = 50001

/** Frigate's home inside its container: config.toml, store.json and the index (db/). */
export const frigateHome = '/root/.frigate'

/**
 * The tweak index and the start-height record beside it. Deleting the directory rebuilds the index
 * from the start height (or, on a pruned node, from the node's prune height).
 */
export const dbDirOnVolume = sdk.volumes.main.subpath('db')
export const startHeightFile = sdk.volumes.main.subpath('db/start-height')

/**
 * Left by Configure Frigate's Rebuild Index, consumed by `main` at its next start: an empty file at
 * the volume root. `main` removes it only after the index is gone, so an interrupted delete repeats.
 * A file rather than a store.json field, because main must not watch it: clearing a watched value
 * from main restarts main while it is still starting.
 */
export const rebuildRequest = sdk.volumes.main.subpath('rebuild.request')

/** Frigate's mainnet default: Taproot activation, where Silent Payments become possible. */
export const taprootActivationHeight = 709632

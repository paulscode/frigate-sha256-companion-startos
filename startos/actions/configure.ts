import { config, isCacheSize } from '../fileModels/config.toml'
import { writeFile } from 'fs/promises'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import {
  blake2bChainSplit,
  rebuildRequest,
  startHeightRecord,
  taprootActivationHeight,
} from '../utils'

const { InputSpec, Value } = sdk

/**
 * Look Back for Payments, as offered: off, the BLAKE2b chain split, Taproot activation, or a block of
 * the user's choosing. Either app can follow either chain, so both offer the split (on the SHA256
 * chain it is just a block). Frigate keeps only the block (index.backfillFromHeight).
 */
const lookBackValues: Record<string, string> = {
  off: i18n('Off (default)'),
  split: i18n('Back to the BLAKE2b chain split (block ${block})', {
    block: String(blake2bChainSplit),
  }),
  taproot: i18n('Back to Taproot activation (block ${block})', {
    block: String(taprootActivationHeight),
  }),
  custom: i18n('Back to the block below'),
}

const lookBackChoice = (
  height: number | undefined,
): { lookBack: string; lookBackHeight: number | null } => {
  if (height === undefined) return { lookBack: 'off', lookBackHeight: null }
  if (height === blake2bChainSplit)
    return { lookBack: 'split', lookBackHeight: null }
  if (height === taprootActivationHeight)
    return { lookBack: 'taproot', lookBackHeight: null }
  return { lookBack: 'custom', lookBackHeight: height }
}

const inputSpec = InputSpec.of({
  indexStartHeight: Value.number({
    name: i18n('Index Start Height'),
    description: i18n(
      'Blocks below this height are not indexed, so Silent Payments in them are not found. The default is Taproot activation (709632), the first block where Silent Payments are possible. On a pruned node, a new index starts a few blocks above the oldest block the node still holds instead, because the node has discarded what it needs for older ones; a larger prune target on the node reaches further back. Changing this rebuilds the index.',
    ),
    required: true,
    integer: true,
    min: 0,
    max: null,
    default: taprootActivationHeight,
  }),
  rebuildIndex: Value.toggle({
    name: i18n('Rebuild Index'),
    description: i18n(
      "Delete the Silent Payments index and build it again on the next start, from the start height above (or the node's prune height on a pruned node). Use it after the node pruned blocks this index still needed, or to start from a different height. Wallets connected meanwhile see only what has been indexed so far. If Look Back for Payments is on, the new index looks back again, at the same cost as the first time.",
    ),
    default: false,
  }),
  lookBack: Value.select({
    name: i18n('Look Back for Payments'),
    description: i18n(
      "Also find Silent Payments in blocks below where the index starts, which a pruned node has already discarded. Frigate fetches each of those blocks from the node's peers and checks it against the node, and looks up the coins its transactions spend through the indexer, checking each against its transaction id. It is done once and covers every wallet, wallets connected meanwhile are told what it finds, and changing this does not rebuild the index. It costs download traffic and time, roughly per 1,000 blocks: on the SHA256 chain 40 to 250 GB, and 5 to 30 hours at full speed or 1 to 5 days in the background; on the BLAKE2b chain since the split 15 to 120 GB, and 2 to 15 hours or 8 to 60 hours. Blocks before the split cost as on the SHA256 chain. The range is wide because it depends on how many old coins the transactions spend. Look back no further than your wallets need.",
    ),
    values: lookBackValues,
    default: 'off',
  }),
  lookBackHeight: Value.number({
    name: i18n('Look Back to Block'),
    description: i18n(
      "Used when Look Back for Payments is set to the block below: for example your wallet's birthday, or the block of its first payment.",
    ),
    required: false,
    integer: true,
    min: 0,
    max: null,
    default: null,
  }),
  lookBackSpeed: Value.select({
    name: i18n('Look Back Speed'),
    description: i18n(
      'Background keeps 4 lookups in flight, a light load on the indexer, the network and this server. Full speed keeps 32, which is several times faster and uses more bandwidth. The download traffic is the same either way.',
    ),
    values: {
      background: i18n('Background (default)'),
      full: i18n('Full speed'),
    },
    default: 'background',
  }),
  scriptPubKeyCacheSize: Value.select({
    name: i18n('Script PubKey Cache Size'),
    description: i18n(
      'How many scriptPubKeys Frigate keeps in memory while indexing. A larger cache indexes faster and uses more RAM; 10M uses about 4 GB.',
    ),
    values: {
      '1M': '1M',
      '5M': '5M',
      '10M': i18n('10M (default)'),
      '20M': '20M',
      '50M': '50M',
    },
    default: '10M',
  }),
  computeBackend: Value.select({
    name: i18n('Compute Backend'),
    description: i18n(
      'Hardware used for historical Silent Payments scans. Mempool and new-block scans always run on the CPU.\n- Auto (prefer GPU): the GPU if one is detected, otherwise the CPU.\n- GPU only: always the GPU.\n- CPU only: never the GPU.',
    ),
    values: {
      AUTO: i18n('Auto (prefer GPU)'),
      GPU: i18n('GPU only'),
      CPU: i18n('CPU only'),
    },
    default: 'AUTO',
  }),
  batchSize: Value.number({
    name: i18n('Batch Size'),
    description: i18n(
      'Transactions processed per GPU dispatch. If scanning hangs or becomes unstable on an older GPU, try 10,000 to 50,000.',
    ),
    required: true,
    integer: true,
    min: 1,
    max: null,
    default: 300000,
  }),
})

export const configure = sdk.Action.withInput(
  'config',

  async ({ effects }) => ({
    name: i18n('Configure Frigate'),
    description: await (async () => {
      // Watched, so the text follows a rebuild or a finished look back
      const start = (
        (await startHeightRecord.read().const(effects)) ?? ''
      ).trim()
      const what = i18n(
        'Index start height, rebuilding the index, looking back for older payments, and scanning performance.',
      )
      return start
        ? `${what} ${i18n('This index starts at block ${start}.', { start })}`
        : what
    })(),
    warning: null,
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),

  inputSpec,

  async () => {
    const c = await config.read().once()
    return {
      indexStartHeight: c?.index.startHeight ?? taprootActivationHeight,
      rebuildIndex: false,
      ...lookBackChoice(c?.index.backfillFromHeight),
      lookBackSpeed: c?.index.backfillSpeed ?? 'background',
      scriptPubKeyCacheSize:
        c && isCacheSize(c.index.cacheSize) ? c.index.cacheSize : '10M',
      computeBackend: c?.scan.computeBackend ?? 'AUTO',
      batchSize: c?.scan.batchSize ?? 300000,
    }
  },

  async ({ effects, input }) => {
    // Frigate never moves an existing index's start: a lower height is ignored and a higher one
    // leaves a gap. So a new start height means a new index.
    const before = await config.read().once()
    const backfillFromHeight =
      input.lookBack === 'off'
        ? undefined
        : input.lookBack === 'split'
          ? blake2bChainSplit
          : input.lookBack === 'taproot'
            ? taprootActivationHeight
            : (input.lookBackHeight ?? undefined)
    if (input.lookBack === 'custom' && backfillFromHeight === undefined) {
      throw new Error(
        i18n(
          'Enter the block to look back to in Look Back to Block, or choose another option.',
        ),
      )
    }
    const rebuild =
      input.rebuildIndex ||
      (before !== null && before.index.startHeight !== input.indexStartHeight)
    if (rebuild) await writeFile(rebuildRequest, '')
    const changed =
      !before ||
      before.index.startHeight !== input.indexStartHeight ||
      before.index.cacheSize !== input.scriptPubKeyCacheSize ||
      before.scan.computeBackend !== input.computeBackend ||
      before.scan.batchSize !== input.batchSize ||
      before.index.backfillFromHeight !== backfillFromHeight ||
      (before.index.backfillSpeed ?? 'background') !== input.lookBackSpeed
    const settings = {
      startHeight: input.indexStartHeight,
      cacheSize: input.scriptPubKeyCacheSize,
      backfillSpeed: input.lookBackSpeed,
    }
    const scan = {
      computeBackend: input.computeBackend,
      batchSize: input.batchSize,
    }
    if (before === null) {
      await config.merge(effects, {
        index: {
          ...settings,
          ...(backfillFromHeight === undefined ? {} : { backfillFromHeight }),
        },
        scan,
      })
    } else {
      // One write, so a change restarts Frigate once. Written whole rather than merged, because a
      // merge cannot remove a key, and a missing backfillFromHeight is how Frigate reads "off".
      const { backfillFromHeight: _old, ...index } = before.index
      await config.write(effects, {
        ...before,
        index: {
          ...index,
          ...settings,
          ...(backfillFromHeight === undefined ? {} : { backfillFromHeight }),
        },
        scan: { ...before.scan, ...scan },
      })
    }
    // A changed setting restarts Frigate by itself (main watches them). A rebuild alone changes
    // nothing main watches, so restart it here, the way Fulcrum Pruned's Reindex does: wait out a
    // start in progress, and ask twice if it is still starting, since one request mid-start is
    // dropped.
    if (rebuild && !changed) {
      let status = await sdk.getStatus(effects).once()
      for (
        let i = 0;
        i < 60 && status?.desired.main === 'running' && !status.started;
        i++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        status = await sdk.getStatus(effects).once()
      }
      if (
        status?.desired.main === 'running' ||
        status?.desired.main === 'restarting'
      ) {
        await sdk.restart(effects)
        if (!status.started) await sdk.restart(effects)
      }
    }
  },
)

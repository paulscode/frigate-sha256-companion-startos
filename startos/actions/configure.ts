import { config, isCacheSize } from '../fileModels/config.toml'
import { writeFile } from 'fs/promises'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { rebuildRequest, taprootActivationHeight } from '../utils'

const { InputSpec, Value } = sdk

const inputSpec = InputSpec.of({
  indexStartHeight: Value.number({
    name: i18n('Index Start Height'),
    description: i18n(
      'Blocks below this height are not indexed, so Silent Payments in them are not found. The default is Taproot activation (709632), the first block where Silent Payments are possible. On a pruned node, a new index starts at the oldest block the node still holds instead, because the node has discarded what it needs for older ones; a larger prune target on the node reaches further back. Changing this rebuilds the index.',
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
      "Delete the Silent Payments index and build it again on the next start, from the start height above (or the node's prune height on a pruned node). Use it after the node pruned blocks this index still needed, or to start from a different height. Wallets connected meanwhile see only what has been indexed so far.",
    ),
    default: false,
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

  async () => ({
    name: i18n('Configure Frigate'),
    description: i18n(
      'Index start height, rebuilding the index, and scanning performance.',
    ),
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
    const rebuild =
      input.rebuildIndex ||
      (before !== null && before.index.startHeight !== input.indexStartHeight)
    if (rebuild) await writeFile(rebuildRequest, '')
    const changed =
      !before ||
      before.index.startHeight !== input.indexStartHeight ||
      before.index.cacheSize !== input.scriptPubKeyCacheSize ||
      before.scan.computeBackend !== input.computeBackend ||
      before.scan.batchSize !== input.batchSize
    await config.merge(effects, {
      index: {
        startHeight: input.indexStartHeight,
        cacheSize: input.scriptPubKeyCacheSize,
      },
      scan: {
        computeBackend: input.computeBackend,
        batchSize: input.batchSize,
      },
    })
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

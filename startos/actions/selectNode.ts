import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { isNodeId, nodes } from '../nodes'
import { sdk } from '../sdk'

const { InputSpec, Value } = sdk

export const selectNode = sdk.Action.withInput(
  'select-node',

  async () => ({
    name: i18n('Select Node'),
    description: i18n(
      'Choose which installed Bitcoin node Frigate reads blocks and the mempool from.',
    ),
    warning: i18n(
      'The node decides which chain this server serves. Select an indexer that follows the same node: Frigate refuses wallets while the two are on different chains. Switching to a node on another chain needs Rebuild Index under Configure Frigate, and with Look Back for Payments on, the new index looks back again, at the same cost.',
    ),
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),

  InputSpec.of({
    node: Value.select({
      name: i18n('Select Node'),
      description: i18n(
        '- Bitcoin Knots: the official Bitcoin service (Knots or Core), or a BLAKE2b build that took its place.\n- Bitcoin Knots (SHA256) Companion: a second, pruned node on the SHA256 chain.\n- Bitcoin Knots (BLAKE2b) Companion: a pruned node on the BLAKE2b chain.\nThe node must be installed on this server.',
      ),
      values: Object.fromEntries(
        Object.entries(nodes).map(([id, n]) => [id, n.title]),
      ) as Record<string, string>,
      default: null,
    }),
  }),

  async () => ({
    node: (await storeJson.read((s) => s.node).once()) ?? undefined,
  }),

  async ({ effects, input }) => {
    if (!isNodeId(input.node)) return
    await storeJson.merge(effects, { node: input.node })
  },
)

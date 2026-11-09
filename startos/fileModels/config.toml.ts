import { FileHelper, z } from '@start9labs/start-sdk'
import { sdk } from '../sdk'
import { taprootActivationHeight } from '../utils'

// StartOS terminates the public TLS listener and connects to Frigate through its lxcbr0 gateway.
// Frigate's per-IP limits would otherwise treat every proxied client as this one address.
export const excludedSubnetsForStartosProxy = (proxyIp: string): string[] => [
  '127.0.0.1/32',
  '::1/128',
  `${proxyIp}/32`,
]

export const cacheSizes = ['1M', '5M', '10M', '20M', '50M'] as const
export const isCacheSize = (
  value: string,
): value is (typeof cacheSizes)[number] =>
  (cacheSizes as readonly string[]).includes(value)

/**
 * Frigate's native config.toml, the parts this package writes. Unknown keys are kept, so a setting
 * added by hand survives (looseObject).
 *
 * `index.startHeight` defaults to Taproot activation, Frigate's own mainnet default. On a pruned
 * node Frigate itself starts a new index at the node's prune height instead, and says so in its
 * log (patch 0003), so the default needs no knowledge of the node here.
 */
const shape = z.looseObject({
  core: z
    .looseObject({
      connect: z.boolean().catch(true),
      server: z.string().optional().catch(undefined),
      authType: z
        .union([z.literal('USERPASS'), z.literal('COOKIE')])
        .catch('COOKIE' as const),
      auth: z.string().catch(''),
      dataDir: z.string().catch('/root/.bitcoin'),
      zmqSequenceEndpoint: z.string().optional().catch(undefined),
    })
    .catch({
      connect: true,
      authType: 'COOKIE' as const,
      auth: '',
      dataDir: '/root/.bitcoin',
    }),
  index: z
    .looseObject({
      startHeight: z.number().catch(taprootActivationHeight),
      cacheSize: z.string().catch('10M'),
      // Look Back for Payments (patch 0008): absent means off
      backfillFromHeight: z.number().optional().catch(undefined),
      backfillSpeed: z
        .union([z.literal('background'), z.literal('full')])
        .optional()
        .catch(undefined),
    })
    .catch({ startHeight: taprootActivationHeight, cacheSize: '10M' }),
  scan: z
    .looseObject({
      computeBackend: z
        .union([z.literal('AUTO'), z.literal('GPU'), z.literal('CPU')])
        .catch('AUTO' as const),
      batchSize: z.number().catch(300000),
    })
    .catch({ computeBackend: 'AUTO' as const, batchSize: 300000 }),
  limits: z
    .looseObject({
      excludedSubnets: z.array(z.string()).catch(['127.0.0.1/32', '::1/128']),
    })
    .catch({ excludedSubnets: ['127.0.0.1/32', '::1/128'] }),
  server: z
    .looseObject({
      backendElectrumServer: z.string().catch(''),
    })
    .catch({ backendElectrumServer: '' }),
})

export const config = FileHelper.toml(
  { base: sdk.volumes.main, subpath: '/config.toml' },
  shape,
)

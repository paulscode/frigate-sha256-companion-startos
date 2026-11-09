import {
  config,
  excludedSubnetsForStartosProxy,
} from '../fileModels/config.toml'
import { storeJson } from '../fileModels/store.json'
import { sdk } from '../sdk'
import { taprootActivationHeight } from '../utils'

/** Writes config.toml and store.json if absent. Install, update and restore all pass through. */
export const seedFiles = sdk.setupOnInit(async (effects) => {
  if (!(await config.read().once())) {
    await config.write(effects, {
      core: {
        connect: true,
        authType: 'COOKIE',
        auth: '',
        dataDir: '/root/.bitcoin',
      },
      index: { startHeight: taprootActivationHeight, cacheSize: '10M' },
      scan: { computeBackend: 'AUTO', batchSize: 300000 },
      limits: {
        excludedSubnets: excludedSubnetsForStartosProxy(
          await sdk.getOsIp(effects),
        ),
      },
      server: { backendElectrumServer: '' },
    })
  }
  if (!(await storeJson.read().once())) {
    await storeJson.write(effects, {
      node: null,
      indexer: null,
    })
  }
})

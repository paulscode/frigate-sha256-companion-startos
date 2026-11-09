import {
  config,
  excludedSubnetsForStartosProxy,
} from '../fileModels/config.toml'
import { storeJson } from '../fileModels/store.json'
import { rename } from 'fs/promises'
import { sdk } from '../sdk'
import { taprootActivationHeight } from '../utils'

/** Writes config.toml and store.json if absent. Install, update and restore all pass through. */
/** A file that no longer parses (edited by hand, cut short) would stop init, main and every action: set it aside, as <name>.broken, and seed it again. */
const readOrSetAside = async <T>(read: () => Promise<T>, path: string) => {
  try {
    return await read()
  } catch (e) {
    console.warn(
      `${path} could not be read (${String(e)}); keeping it as ${path}.broken and writing a fresh one`,
    )
    await rename(path, `${path}.broken`).catch(() => {})
    return null
  }
}

export const seedFiles = sdk.setupOnInit(async (effects) => {
  if (
    !(await readOrSetAside(
      () => config.read().once(),
      sdk.volumes.main.subpath('config.toml'),
    ))
  ) {
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
  if (
    !(await readOrSetAside(
      () => storeJson.read().once(),
      sdk.volumes.main.subpath('store.json'),
    ))
  ) {
    await storeJson.write(effects, {
      node: null,
      indexer: null,
    })
  }
})

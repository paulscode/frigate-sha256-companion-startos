import { manifest as bitcoinManifest } from 'bitcoin-core-startos/startos/manifest'
import { existsSync } from 'fs'
import { readFile, rm } from 'fs/promises'
import { StringDecoder } from 'string_decoder'
import {
  config,
  excludedSubnetsForStartosProxy,
} from './fileModels/config.toml'
import { storeJson } from './fileModels/store.json'
import { i18n } from './i18n'
import { indexers } from './indexers'
import { nodes } from './nodes'
import { sdk } from './sdk'
import {
  dbDirOnVolume,
  electrumPort,
  frigateHome,
  rebuildRequest,
  recentBlocksFile,
  startHeightFile,
} from './utils'

export const main = sdk.setupMain(async ({ effects }) => {
  console.info(i18n('Starting Frigate...'))

  // Restart on the user's settings only. The address rewrites below restart main only when the
  // selected node's or indexer's bridge address changes.
  await config.read(({ index, scan }) => ({ index, scan })).const(effects)
  const nodeId = await storeJson.read((s) => s.node).const(effects)
  const indexerId = await storeJson.read((s) => s.indexer).const(effects)
  if (!nodeId || !indexerId) {
    throw new Error(
      i18n(
        'Choose a node with Select Node and an indexer with Select Indexer.',
      ),
    )
  }
  const node = nodes[nodeId]
  const indexer = indexers[indexerId]

  // Rebuild Index (Configure Frigate): the index and its start-height record go; Frigate builds a
  // new one from the start height, or from the node's prune height on a pruned node.
  if (existsSync(rebuildRequest)) {
    console.warn('Rebuild Index requested: deleting the Silent Payments index')
    await rm(dbDirOnVolume, { recursive: true, force: true })
    // The hashes of the last indexed blocks, which the next index must not be checked against.
    await rm(recentBlocksFile, { force: true })
    await rm(rebuildRequest, { force: true })
  }

  // The node's RPC over the LXC bridge: its btc-rpc-proxy when it prunes. Null while the node is
  // absent, in which case its volume is not mounted (a missing dependency's mount would fail the
  // start), Frigate waits for a cookie, and the .const() heals it with one restart.
  const rpc = await sdk.host
    .getBridgeAddress(effects, {
      packageId: nodeId,
      hostId: node.rpc.hostId,
      internalPort: node.rpc.port,
      ssl: false,
    })
    .const()
  const zmq = await sdk.host
    .getBridgeAddress(effects, {
      packageId: nodeId,
      hostId: node.zmq.hostId,
      internalPort: node.zmq.port,
    })
    .const()
    .catch(() => null)
  const backend = await sdk.host
    .getBridgeAddress(effects, {
      packageId: indexerId,
      hostId: indexer.hostId,
      internalPort: indexer.port,
      ssl: false,
    })
    .const()

  await config.merge(
    effects,
    {
      core: {
        connect: true,
        server: rpc ? `http://${rpc}` : undefined,
        authType: 'COOKIE',
        auth: '',
        dataDir: '/root/.bitcoin',
        // Every node here publishes `sequence` beside rawtx when its ZeroMQ is on. When it is off
        // nothing listens there, Frigate never hears from it, and it polls every 5 seconds instead.
        zmqSequenceEndpoint: zmq ? `tcp://${zmq}` : undefined,
      },
      server: { backendElectrumServer: backend ? `tcp://${backend}` : '' },
      limits: {
        excludedSubnets: excludedSubnetsForStartosProxy(
          await sdk.getOsIp(effects),
        ),
      },
    },
    { allowWriteAfterConst: true },
  )

  const volume = sdk.Mounts.of().mountVolume({
    volumeId: 'main',
    subpath: null,
    mountpoint: frigateHome,
    readonly: false,
  })
  const subcontainer = await sdk.SubContainer.of(
    effects,
    { imageId: 'main' },
    rpc
      ? volume.mountDependency<typeof bitcoinManifest>({
          // Any of the three; they share the volume id `main`, with the mainnet cookie at its root.
          dependencyId: nodeId as 'bitcoind',
          volumeId: 'main',
          subpath: null,
          mountpoint: '/root/.bitcoin',
          readonly: true,
        })
      : volume,
    'main',
  )

  // What Frigate's log says, for the health checks. Frigate announces the index it is about to
  // build a few seconds after launch, then reports progress every 30s.
  let indexing = false
  let waitingForNodeSync = false
  let lastProgress: string | null = null
  let fatal: string | null = null
  let backendCheck: 'unknown' | 'same' | 'different' = 'unknown'
  // Look Back for Payments (the backfill), which runs once the index has caught up with the tip
  let backfillTarget: string | null = null
  let backfillProgress: string | null = null
  let backfillWaiting: string | null = null
  let backendDetail: string | null = null

  const onLine = (line: string) => {
    if (/Indexing \d+ blocks|Block index is up to date/.test(line))
      indexing = true
    if (line.includes('Waiting for sync to complete')) waitingForNodeSync = true
    if (/Indexing \d+ blocks/.test(line)) waitingForNodeSync = false
    const progress = /Indexing progress: (.+)/.exec(line)
    if (progress) {
      indexing = true
      lastProgress = progress[1].trim()
    }
    const bfStart =
      /Backfill: (?:looking back to block|resuming at block \d+, looking back to block) (\d+)/.exec(
        line,
      )
    if (bfStart) {
      backfillTarget = bfStart[1]
      backfillProgress = null
      backfillWaiting = null
    }
    const bfProgress = /Backfill progress: (.+)/.exec(line)
    if (bfProgress) {
      backfillProgress = bfProgress[1].trim()
      backfillWaiting = null
    }
    const bfWaiting = /Backfill waiting: (.+)/.exec(line)
    if (bfWaiting) backfillWaiting = bfWaiting[1].trim().slice(0, 300)
    if (
      /Backfill complete|Backfill stopping|Backfill stopped by an error/.test(
        line,
      )
    ) {
      backfillTarget = null
      backfillProgress = null
      backfillWaiting = null
    }
    const f = /FATAL: (.+)/.exec(line)
    if (f) fatal = f[1].trim().slice(0, 400)
    if (line.includes('Backend chain check: the Electrum backend follows')) {
      backendCheck = 'same'
      backendDetail = null
    }
    const failed = /Backend chain check FAILED: (.+)/.exec(line)
    if (failed) {
      backendCheck = 'different'
      backendDetail = failed[1].trim().slice(0, 300)
    }
  }
  const lineReader = () => {
    let pending = ''
    const decoder = new StringDecoder('utf8')
    return (chunk: unknown, log: (s: string) => void) => {
      const text = Buffer.isBuffer(chunk) ? decoder.write(chunk) : String(chunk)
      log(text)
      pending += text
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      lines.forEach(onLine)
    }
  }
  const stdout = lineReader()
  const stderr = lineReader()

  const listening = () =>
    sdk.healthCheck.checkPortListening(effects, electrumPort, {
      successMessage: '',
      errorMessage: '',
    })
  const indexStart = async () =>
    (await readFile(startHeightFile, 'utf8').catch(() => '')).trim()

  return sdk.Daemons.of(effects)
    .addDaemon('primary', {
      subcontainer,
      exec: {
        fn: async () => {
          indexing = false
          lastProgress = null
          fatal = null
          backfillTarget = null
          backfillProgress = null
          backfillWaiting = null
          return {
            command: [
              'sh',
              '-c',
              // Frigate stops at once without the node's cookie, so wait for it (the node starting,
              // or not yet installed), then run the image's own entrypoint, passing a stop on to it.
              `for i in $(seq 1 300); do
  [ -r /root/.bitcoin/.cookie ] && break
  [ "$i" = 1 ] && echo "Waiting for the node's RPC cookie"
  sleep 1
done
/usr/local/bin/docker-entrypoint.sh &
pid=$!
trap 'kill -TERM "$pid" 2>/dev/null; wait "$pid"; exit 0' TERM INT
wait "$pid"; rc=$?
# 3: a stop that restarting cannot fix (a block the index needs was pruned, or the index belongs to
# another chain). Hold here rather than restart into the same stop every 30 seconds, so the FATAL
# line stays the health message until Rebuild Index restarts the service.
if [ "$rc" = 3 ]; then
  echo "Frigate has stopped and will not restart by itself. Run Configure Frigate with Rebuild Index on."
  while true; do sleep 3600 & wait $!; done
fi
exit "$rc"`,
            ],
            env: { NETWORK: 'mainnet' },
            onStdout: (chunk) => stdout(chunk, console.log),
            onStderr: (chunk) => stderr(chunk, console.error),
          }
        },
      },
      ready: {
        display: i18n('Electrum Server'),
        fn: async () => {
          if ((await listening()).result === 'success') {
            return { result: 'success', message: i18n('Frigate is ready') }
          }
          if (fatal) return { result: 'failure', message: fatal }
          if (!rpc) {
            return { result: 'starting', message: i18n('Waiting for the node') }
          }
          if (indexing || waitingForNodeSync) {
            return {
              result: 'loading',
              message: i18n(
                'Frigate opens its Electrum port once its index has caught up with the node.',
              ),
            }
          }
          return { result: 'starting', message: i18n('Frigate is starting') }
        },
      },
      requires: [],
    })
    .addHealthCheck('sync-progress', {
      ready: {
        display: i18n('Sync Progress'),
        fn: async () => {
          const start = await indexStart()
          if ((await listening()).result === 'success') {
            const synced = start
              ? i18n(
                  'Fully synced. Silent Payments are indexed from block ${start}.',
                  { start },
                )
              : i18n('Fully synced')
            // Wallets are served throughout a backfill, so it reports as success
            const lookingBack =
              backfillTarget === null
                ? null
                : backfillWaiting
                  ? i18n(
                      'Looking back to block ${target} is waiting: ${reason}',
                      { target: backfillTarget, reason: backfillWaiting },
                    )
                  : backfillProgress
                    ? i18n('Looking back to block ${target}: ${progress}', {
                        target: backfillTarget,
                        progress: backfillProgress,
                      })
                    : i18n('Looking back to block ${target}', {
                        target: backfillTarget,
                      })
            return {
              result: 'success',
              message: lookingBack ? `${synced} ${lookingBack}` : synced,
            }
          }
          if (fatal) return { result: 'failure', message: fatal }
          if (waitingForNodeSync) {
            return {
              result: 'loading',
              message: i18n('Waiting for the node to finish syncing'),
            }
          }
          if (lastProgress) {
            return {
              result: 'loading',
              message: start
                ? i18n('Indexing from block ${start}: ${progress}', {
                    start,
                    progress: lastProgress,
                  })
                : lastProgress,
            }
          }
          return { result: 'loading', message: i18n('Frigate is syncing...') }
        },
      },
      requires: [],
    })
    .addHealthCheck('indexer', {
      ready: {
        display: i18n('Indexer'),
        fn: async () => {
          if (backendCheck === 'same') {
            return {
              result: 'success',
              message: i18n('${indexer} follows the same chain as ${node}', {
                indexer: indexer.title,
                node: node.title,
              }),
            }
          }
          if (backendCheck === 'different') {
            return {
              result: 'failure',
              message: i18n(
                '${indexer} follows a different chain from ${node}, so wallets are refused. Point ${indexer} at ${node} (its Select Node), or select another indexer. ${detail}',
                {
                  indexer: indexer.title,
                  node: node.title,
                  detail: backendDetail ?? '',
                },
              ),
            }
          }
          return {
            result: 'loading',
            message: i18n(
              'Frigate checks that ${indexer} follows the same chain as ${node} once its own index has caught up. An indexer opens its Electrum port only once it has caught up with its node.',
              { indexer: indexer.title, node: node.title },
            ),
          }
        },
      },
      requires: [],
    })
})

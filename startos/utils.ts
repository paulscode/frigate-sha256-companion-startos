import { FileHelper } from '@start9labs/start-sdk'
import { sdk } from './sdk'
import type { healthFns } from '@start9labs/start-sdk'
import { i18n } from './i18n'

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
/** The same record, watchable: Rebuild Index and a finished Look Back for Payments both rewrite it. */
export const startHeightRecord = FileHelper.string({
  base: sdk.volumes.main,
  subpath: '/db/start-height',
})
/** Frigate's record of the last indexed blocks' hashes, kept beside db/; cleared with the index. */
export const recentBlocksFile = sdk.volumes.main.subpath('recentblocks')

/**
 * Left by Configure Frigate's Rebuild Index, consumed by `main` at its next start: an empty file at
 * the volume root. `main` removes it only after the index is gone, so an interrupted delete repeats.
 * A file rather than a store.json field, because main must not watch it: clearing a watched value
 * from main restarts main while it is still starting.
 */
export const rebuildRequest = sdk.volumes.main.subpath('rebuild.request')

/** Frigate's mainnet default: Taproot activation, where Silent Payments become possible. */
export const taprootActivationHeight = 709632
/** The first BLAKE2b block, where the BLAKE2b chain split from the SHA256 chain. */
export const blake2bChainSplit = 961640

// ---- Bounded health checks ----

type Result = healthFns.HealthCheckResult

/**
 * How long one run of a health check may take before it is treated as
 * unanswered. None of the three checks here (Electrum Server, Sync Progress,
 * Indexer) runs a command or calls Frigate, the node or the indexer: they read
 * what Frigate has logged, `/proc/net` through `checkPortListening` (which
 * gives up after its own 1 s), and Sync Progress reads the index's
 * `start-height` file on the volume. Each answers in milliseconds, so a minute
 * only ever runs out on a read that is not coming back. It is not a limit on
 * Frigate: nothing is killed.
 */
export const CHECK_TIMEOUT_MS = 60_000

/**
 * How many runs in a row may go unanswered while the check keeps showing its
 * last real result. Anything but `success` pauses every daemon that
 * `requires` the check, so one slow answer must not stop them; a check
 * that stays unanswered must still say so.
 */
export const STALE_REPEATS = 2

/**
 * Wrap a health check's `fn` so a run that never returns cannot wedge it.
 *
 * Why this exists: start-sdk's `HealthDaemon.runHealthCheckLoop` awaits `fn()`
 * with no limit and only looks at its abort signal once `fn()` returns. When a
 * service stops, `Daemons` terms entries in reverse dependency order (`_term`,
 * and `stopEntries` when it reconciles) and waits for every one to finish, and
 * each term first waits for its check's loop to end: a daemon's own `ready`
 * loop before its process is signalled. So one `fn()` that never returns
 * freezes its check at "Starting" for the life of the service, and later
 * blocks every stop, update and restart (with Electrum Server's check, before
 * Frigate is ever signalled). In Bitcoin Knots (BLAKE2b) Companion that left
 * the node running while an update sat at "Installing 80%" and the OS Restart
 * hung (knots-blake2b-startos#4). The checks here wait on no subcontainer `exec`,
 * the usual culprit (its 30 s timeout is armed only after it has waited,
 * without a limit, for its file mounts to sync), but they still await file
 * reads that have no limit of their own, and so would any check added later.
 *
 * At most one run is outstanding. If the previous one is still pending when
 * the check fires again, this waits on that run again rather than starting
 * another, so a call that never returns costs one pending promise, not one a
 * minute. A run that finishes after it was given up on keeps its result for
 * the next call, which returns it rather than starting over, so a check that
 * always takes a little longer than the bound still reports.
 */
export function bounded(
  fn: () => Result | Promise<Result>,
  onTimeout: () => Result,
  ms: number = CHECK_TIMEOUT_MS,
): () => Promise<Result> {
  let inFlight: Promise<Result> | null = null
  let abandoned: Promise<Result> | null = null
  let late: Result | null = null
  let last: Result | null = null
  let misses = 0

  return async () => {
    if (!inFlight && late) {
      const res = late
      late = null
      misses = 0
      last = res
      return res
    }
    if (!inFlight) {
      const run = Promise.resolve()
        .then(fn)
        .finally(() => {
          if (inFlight === run) inFlight = null
        })
      inFlight = run
      run.then(
        (res) => {
          if (abandoned === run) late = res
        },
        () => {},
      )
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms)
    })
    const current = inFlight
    try {
      // The race also handles the run, so if it is abandoned here and rejects
      // later there is no unhandled rejection to take down the runtime.
      const res = await Promise.race([current, timedOut])
      if (res !== null) {
        // Answered here, so it is not kept for the next call as well.
        if (abandoned === current) abandoned = late = null
        misses = 0
        last = res
        return res
      }
    } catch (e) {
      // A thrown fn is the SDK's to report, exactly as before.
      misses = 0
      last = null
      throw e
    } finally {
      clearTimeout(timer)
    }

    abandoned = current
    misses += 1
    console.warn(
      `health check run unanswered after ${ms / 1000}s (${misses} in a row)`,
    )
    if (last && misses <= STALE_REPEATS) return last
    return onTimeout()
  }
}

// What a health check shows when a run of it has not finished in time:
// starting, never failure, so a slow answer does not read as a fault. The
// check shows its result again once that run finishes.
export const unanswered = () => ({
  result: 'starting' as const,
  message: i18n('This check has not finished after a minute'),
})

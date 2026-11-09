<p align="center">
  <img src="icon.png" alt="Frigate (SHA256) Companion logo" width="21%">
</p>

# Frigate Electrum Server (SHA256) Companion on StartOS

> Everything not listed in this document should behave the same as upstream Frigate. If a
> feature, setting, or behavior is not mentioned here, the upstream documentation is accurate and
> fully applicable; see the Documentation section of `instructions.md` for links.

[Frigate](https://github.com/sparrowwallet/frigate) is an experimental Electrum server from the
Sparrow Wallet team. It scans the chain for Silent Payments (BIP352) on a wallet's behalf using
ephemeral client keys, keeps the resulting tweak index in DuckDB, and can offload the scan to a
GPU. It is not the Frigate NVR project.

This companion runs **beside** the official Frigate package rather than in its place, and differs
from it in three ways: it works with a **pruned** node and never needs `txindex`; it serves the
**BLAKE2b** chain as well as the SHA256 one (it follows whichever node is selected); and it uses
**Electrs Pruned** or **Fulcrum Pruned** as its Electrum backend. It is one of two companions,
the other being Frigate Electrum Server (BLAKE2b) Companion (`frigate-blake2b-companion`); the two
packages are identical except for their id, title, icon and the node they prefer at install, so a
server can run one per chain.

- **Upstream repo:** <https://github.com/sparrowwallet/frigate>
- **Wrapper repo:** <https://github.com/paulscode/frigate-sha256-companion-startos>
- **Parent wrapper repo:** <https://github.com/Start9-Community/frigate-startos>
- **StartOS service ID:** `frigate-sha256-companion`

---

## Table of Contents

- [Image and Container Runtime](#image-and-container-runtime)
- [Volume and Data Layout](#volume-and-data-layout)
- [File Models](#file-models)
- [Dependencies](#dependencies)
- [Network Access and Interfaces](#network-access-and-interfaces)
- [Installation and First-Run Flow](#installation-and-first-run-flow)
- [Actions](#actions)
- [Tasks](#tasks)
- [Health Checks](#health-checks)
- [Backups and Restore](#backups-and-restore)
- [Limitations and Differences](#limitations-and-differences)
- [Quick Reference for AI Consumers](#quick-reference-for-ai-consumers)

---

## Image and Container Runtime

The image builds Frigate 1.6.1 from a SHA256-verified archive of the upstream tag, swaps in a
BLAKE2b-aware drongo (`paulscode/drongo`, branch `blake2b`, also verified by archive SHA256),
applies `patches/` with `patch -p1 --fuzz=0`, runs Frigate's tests (x86_64), and lays the jlink
runtime over the digest-pinned community image `ghcr.io/remcoros/frigate-docker`, keeping that
image's entrypoint and Intel OpenCL runtime. See `Dockerfile`.

| patch | what |
|---|---|
| 0001 | upstream (post-1.6.1): retry block fetches when the node connection drops |
| 0002 | upstream (post-1.6.1): notifications without an id |
| 0003 | serve the node's raw tip header (164 bytes on BLAKE2b); index a pruned node with `getblock` verbosity 3; mempool prevouts from `gettxout` (no `txindex`); start a new index at the node's prune height; stop with `FATAL` when a needed block has been pruned |
| 0004 | Electrum protocol 1.8 on a chain with v2 headers (refuse lower, as Electrs Pruned does), `blake2b_fork` in `server.features`, and a check that the backend follows the same chain |
| 0005 | stop with `FATAL` when the index belongs to another chain than the node's (a node switched across the SHA256/BLAKE2b split), instead of rolling back 10 blocks and mixing the two chains' tweaks |
| 0006 | stop indexing at the next block on shutdown, so a stop or update during a long index is prompt (the next start resumes) |

| Property | Value |
|---|---|
| Image | built from `Dockerfile` over `ghcr.io/remcoros/frigate-docker:1.6.1` |
| Architectures | x86_64, aarch64 |
| Entrypoint | the base image's, `frigate -n "$NETWORK"`, after waiting for the node's cookie |

One subcontainer, `main`, running the `primary` daemon. Only the generic image is built: CPU, or a
recent Intel iGPU (Gen12 and newer) through `/dev/dri` (`hardwareAcceleration`). NVIDIA and AMD
variants are not built.

## Volume and Data Layout

One volume, `main`, mounted at `/root/.frigate`.

| Path | What |
|---|---|
| `config.toml` | Frigate's configuration (see File Models) |
| `store.json` | the selected node and indexer |
| `rebuild.request` | present while a Rebuild Index is pending; `main` deletes `db/` and then this file at the next start |
| `db/frigate.duckdb` | the Silent Payments tweak index; rebuildable, excluded from backup |
| `db/start-height` | the first block the index covers, written by Frigate when the index starts |

The selected node's `main` volume is mounted read-only at `/root/.bitcoin` for its RPC cookie.

## File Models

- **`config.toml`**, Frigate's own. The package writes `core.server` (the node's RPC over the
  bridge, which on a pruned node is its btc-rpc-proxy), `core.dataDir`, `core.zmqSequenceEndpoint`
  (the node's ZeroMQ port 28333; unused if the node has ZeroMQ off), `server.backendElectrumServer`
  and `limits.excludedSubnets` on every start, and `index.*`/`scan.*` from Configure Frigate.
  Other keys are kept.
- **`store.json`**: `node`, `indexer`.

## Dependencies

Exactly one node and one indexer, each chosen by an action; each candidate is an optional
dependency enabled only while selected. **No autoconfig task** is raised on the node: no
`txindex`, no change to pruning, no ZeroMQ.

| Node (Select Node) | id | health checks | version |
|---|---|---|---|
| Bitcoin Knots (official, Knots or Core, or a BLAKE2b build under that id) | `bitcoind` | `bitcoind`, `sync-progress` | Start9 builds with btc-rpc-proxy v0.8.1+, `#knotsprerdts:29.3:29`, `#knots:29.4.2:4` |
| Bitcoin Knots (SHA256) Companion | `knots-prerdts` | `bitcoind`, `sync-progress` | `>=#knotsprerdts:29.3:29` |
| Bitcoin Knots (BLAKE2b) Companion | `knots-blake2b` | `node`, `chain` | `>=29.4.3:1` |

| Indexer (Select Indexer) | id | health checks | version |
|---|---|---|---|
| Electrs Pruned | `electrs-pruned` | `electrs`, `sync` | `>=0.11.1:48` |
| Fulcrum Pruned | `fulcrum-pruned` | `primary`, `sync-progress` | `>=2.1.4:1` |
| Electrs (archival node) | `electrs` | `electrs`, `sync` | `>=0.11.1:11` |
| Fulcrum (archival node, txindex) | `fulcrum` | `primary`, `sync-progress` | `>=2.1.1:8`, or privkeyio's `#blake:2.1.4:0` |

The indexer must follow the same chain as the node. Frigate checks this itself (patch 0004) by
comparing a recent header from each, at start and every ten minutes, and refuses wallets while they
differ.

## Network Access and Interfaces

| Interface | Port | Protocol | Purpose |
|---|---|---|---|
| Electrum (SSL) (`electrum`) | 50001 internal; preferred external 50022 (SSL), 50021 (plaintext, bridge only) | Electrum over TLS | wallets |

Preferred external ports differ from the official Frigate's (50002/50001) and from the BLAKE2b
companion's (50032/50031). StartOS assigns the actual ports per server; never quote a literal one.

## Installation and First-Run Flow

1. On install the package chooses the node this app is named for (`knots-prerdts`) if installed,
   else the only supported node installed; and the only supported indexer installed. Otherwise
   it raises a critical **Select Node** and/or **Select Indexer** task, which keeps Frigate
   stopped until answered.
2. Frigate waits for the node's cookie, connects, and builds its index from the start height
   (default 709632). On a **pruned** node a new index starts at the node's prune height plus 6
   blocks instead, logged as `Silent Payments index starts at block N` and recorded in
   `db/start-height`.
3. The Electrum port opens once the index has caught up with the node.

## Actions

| Action | What |
|---|---|
| Select Node | which installed node Frigate follows |
| Select Indexer | which Electrum server Frigate passes address lookups to |
| Configure Frigate | start height, Rebuild Index, scriptPubKey cache, compute backend, batch size. A changed start height rebuilds the index, since Frigate never moves an existing index's start |

## Tasks

Critical **Select Node** and **Select Indexer** at install when the choice cannot be made (see
above). Nothing is ever asked of the node.

## Health Checks

| Check | Meaning |
|---|---|
| Electrum Server (`primary`) | the Electrum port is listening (LISTEN state); loading while indexing; failure with Frigate's `FATAL` line |
| Sync Progress (`sync-progress`) | index progress, and once synced the block it starts from; failure on `FATAL` (for example a block the node pruned while Frigate was stopped: run Rebuild Index) |
| Indexer (`indexer`) | the backend chain check: success when the indexer follows the node's chain, failure when it does not |

## Backups and Restore

The volume is backed up except `db/` (the index) and `frigate.log`. A restore rebuilds the index.

## Limitations and Differences

1. **Pruned nodes index from the prune height.** Silent Payments received in blocks the node has
   discarded are not found; a larger prune target reaches further back. A backfill below the prune
   height is not implemented yet.
2. **If the node prunes past the index while Frigate is stopped,** Frigate stops with a `FATAL`
   message rather than skipping blocks; Rebuild Index starts a new index.
   The same happens if the selected node is switched to one on the other chain: the old index
   cannot be reused.
3. **On the BLAKE2b chain** wallets must speak Electrum protocol 1.8 (the Sparrow BLAKE2b fork
   does); older wallets are refused with a reason. `server.features` carries `blake2b_fork`.
4. Only the generic image (CPU, recent Intel iGPU). No NVIDIA or AMD builds.
5. ZeroMQ is used only if the node already publishes it; otherwise Frigate polls every 5 seconds,
   which delays mempool notifications by up to that much.
6. Mainnet only.

## Quick Reference for AI Consumers

```yaml
package_id: frigate-sha256-companion
image: built from Dockerfile (Frigate 1.6.1 + patches/ + paulscode/drongo blake2b) over ghcr.io/remcoros/frigate-docker:1.6.1
architectures: [x86_64, aarch64]
volumes:
  main: /root/.frigate
ports:
  electrum: 50001
dependencies:
  node: one of bitcoind | knots-prerdts | knots-blake2b (Select Node)
  indexer: one of electrs-pruned | fulcrum-pruned | electrs | fulcrum (Select Indexer)
actions: [select-node, select-indexer, config]
health_checks: [primary, sync-progress, indexer]
backup_excludes: [/db, /frigate.log]
logs_to_watch:
  - "Silent Payments index starts at block N"
  - "Backend chain check: ..." / "Backend chain check FAILED: ..."
  - "FATAL: ..."
```

# Frigate Electrum Server (SHA256) Companion

## Documentation

- [Start9 Bitcoin Guides](https://docs.start9.com/bitcoin-guides/): what an Electrum server is, pointing a wallet at one, and archival versus pruned Bitcoin nodes.
- [Frigate README](https://github.com/sparrowwallet/frigate/blob/master/README.md): the upstream project page and the full `config.toml` reference.
- [BIP352](https://github.com/bitcoin/bips/blob/master/bip-0352.mediawiki): the Silent Payments specification Frigate implements.

## What you get on StartOS

An Electrum server that scans the blockchain for Silent Payments on your wallet's behalf, without learning which payments are yours. Point a Silent Payments wallet at its Electrum address and it can find its incoming payments without downloading the chain itself.

This companion runs beside the official Frigate, works with a **pruned** node, and needs no `txindex`. It follows whichever Bitcoin node you select, on the SHA256 chain or the BLAKE2b chain. It is named for the SHA256 chain, the pairing it is meant for; its twin, Frigate Electrum Server (BLAKE2b) Companion, lets one server run Frigate for each chain.

Frigate answers Silent Payments queries itself and passes everything else, ordinary address lookups included, to an **indexer**: Electrs Pruned or Fulcrum Pruned (Electrs or Fulcrum also work with an archival node).

## Getting set up

1. **Install a Bitcoin node** and let it sync. Any of the official Bitcoin service, Bitcoin Knots (SHA256) Companion or Bitcoin Knots (BLAKE2b) Companion. Pruned is fine. Nothing needs changing in its settings.
2. **Install an indexer that follows the same node**: Electrs Pruned or Fulcrum Pruned, pointed at that node with its own Select Node. If your server runs two pruned nodes, run Electrs Pruned on one and Fulcrum Pruned on the other.
3. **Install this service.** If it cannot tell which node and indexer you mean, it asks: answer **Select Node** and **Select Indexer**.
4. **Wait for the first index.** Frigate's Electrum address accepts connections once the index has caught up. **Sync Progress** shows how far it has got. On a pruned node this is quick, because there are only the blocks the node keeps.
5. **Connect your wallet** to Frigate's Electrum address.

## How far back it finds payments

Frigate finds Silent Payments made at or after the block its index starts from. **Sync Progress** shows that block once it is synced.

- **On a pruned node** a new index starts a few blocks above the oldest block the node still holds, because the node has discarded what Frigate needs for older blocks. A larger prune target on the node keeps more blocks and so reaches further back: the node keeps as many recent blocks as fit in its prune target.
- **On an archival node** it starts at Taproot activation (block 709632), where Silent Payments became possible, unless you set a later block in **Configure Frigate**. A later start makes the first index faster.

Once indexed, a block stays in Frigate's index: pruning on the node later only limits where a *new* index can start. So on a pruned node, install Frigate early. On the BLAKE2b chain, a node that still holds the blocks from a few before the first BLAKE2b block (961640) gives an index that covers every block since the split, and keeps it.

Changing the start height rebuilds the index.

### Looking back further

On a pruned node, **Configure Frigate** can also **Look Back for Payments** below where the index starts:

- **Back to the BLAKE2b chain split** (block 961640): every block since the BLAKE2b chain split from the SHA256 chain. On the SHA256 chain this is simply block 961640, with no special meaning.
- **Back to Taproot activation** (block 709632): every block where a Silent Payment is possible. On a pruned node this is a very large download; see below.
- **Back to the block below**: a block you enter in **Look Back to Block**, such as your wallet's birthday.

Frigate fetches each of those blocks from the node's peers and checks it against the node, and looks up the coins their transactions spend through your indexer, checking each against its transaction id, so it trusts neither. It is done once and covers every wallet: a wallet added later finds its payments in the same blocks. Wallets connected meanwhile are told about payments as they are found. **Sync Progress** shows how far it has got and roughly how long is left. A stop resumes where it left off, and changing the setting does not rebuild the index.

It costs download traffic and time. Roughly, per 1,000 blocks:

- **SHA256 chain:** 40 to 250 GB, and 5 to 30 hours at full speed or 1 to 5 days in the background.
- **BLAKE2b chain, since the split:** 15 to 120 GB, and 2 to 15 hours at full speed or 8 to 60 hours in the background. Blocks before the split cost as on the SHA256 chain.

The range is wide because it depends on how many old coins the blocks' transactions spend. **Look Back Speed** sets the pace: **Background** keeps a light load on the indexer, the network and the server; **Full speed** is several times faster. The traffic is the same either way, so on a metered connection look back no further than your wallets need.

If Frigate is stopped for long enough that the node discards blocks the index still needs, Frigate stops and says so rather than skip them. Run **Configure Frigate** with **Rebuild Index** on, and it starts a new index from the node's current oldest block. With Look Back for Payments on, the new index looks back again, at the same cost as the first time.

## The BLAKE2b chain

When Frigate follows a node on the BLAKE2b chain, wallets must support Electrum protocol 1.8, because block headers there are longer and hashed differently. The Sparrow BLAKE2b build does. Older wallets are refused with a message saying why, rather than shown a broken chain.

## Using a GPU

Frigate can scan far faster on a GPU. **Compute Backend** in **Configure Frigate** defaults to **Auto**. This package ships the standard build only, which uses recent Intel integrated graphics (roughly 11th-generation Core and newer) or the CPU. If scanning stalls on a GPU, lower **Batch Size**.

## Limitations

- Frigate is experimental, and so is wallet support for Silent Payments. Treat it as something to try rather than something to depend on.
- On a pruned node, payments in blocks the node has discarded are found only with **Look Back for Payments**, at its cost.
- If the node has ZeroMQ turned off, Frigate checks for new mempool transactions every 5 seconds instead of at once. Nothing else changes.

# AGENTS.md

A StartOS service package: one of the two Frigate Electrum Server companions, `frigate-sha256-companion`
and `frigate-blake2b-companion` (see `startos/chain.ts` for which this is).
Built locally with the workspace's `release.sh`, never in CI. SDK 3.1.1.

- **Two packages, one codebase.** `frigate-sha256-companion-startos` and
  `frigate-blake2b-companion-startos` are identical except `startos/chain.ts`, the manifest id, the
  icons, `README.md`, `instructions.md` and the package name. Edit the SHA256 one, then run
  `/mnt/Black/frigate-companions/tools/sync-packages.sh`.
- **Frigate's changes are `patches/`**, generated from a working tree in the frigate-companions
  project (`work/frigate-src`); never edit a patch file by hand. See UPDATING.md.
- **No autoconfig task on the node, ever.** Pruned support is the point of this package.
- **Never run `npm install` or `npm update`.** The lockfile pins `github:` dependencies that move
  upstream. `npm ci` only.
- i18n: `python3 /mnt/Black/fulcrum-pruned/packaging/gen-i18n-dict.py .` regenerates the default
  dictionary from the source; `translations.ts` stays empty.
- Version ranges: check with the SDK's comparator (`node_modules/@start9labs/start-sdk/node_modules/@start9labs/start-core/exver`), not by reading.

# Updating

## Frigate (upstream)

1. In the frigate-companions project's working tree (`work/frigate-src`, branch `companion`), rebase
   the series onto the new upstream tag (`git rebase --onto <tag> <old tag> companion`). Drop any
   backported patch (0001, 0002) that the tag now contains.
2. Build and test there (`./gradlew test`), and run `spikes/harness/e2e.py` and `spikes/harness/bf.py` (the backfill) on both chains, with both indexers.
3. Export with `/mnt/Black/frigate-companions/tools/export-patches.sh` (set its `BASE` to the new
   tag first): it clears `patches/`, writes the patches and `patches/SHA256SUMS` (the Dockerfile
   applies exactly the listed patches), and copies them to the BLAKE2b package.
4. In `Dockerfile`, set `FRIGATE_COMMIT` to the tag's commit and `FRIGATE_SHA256` to the SHA256 of
   `https://github.com/sparrowwallet/frigate/archive/<commit>.tar.gz`. If the community base image
   has a new release, update `BASE_IMAGE` (tag and digest together).
5. Bump `startos/versions/current.ts` (`<upstream>:0`), with release notes.
6. Run `tools/sync-packages.sh` in the frigate-companions project to carry the change to the
   BLAKE2b companion, and commit both.

## drongo

Set `DRONGO_COMMIT` and `DRONGO_SHA256` (archive of `paulscode/drongo` at that commit) together.
Frigate's tests run in the image build on x86_64; check the BLAKE2b header tests pass.

## Package only

Bump the revision (`1.6.1:N` to `1.6.1:N+1`) in `startos/versions/current.ts` for any change that
ships, even a title change. Never change the package id.

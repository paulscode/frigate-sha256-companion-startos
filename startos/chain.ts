/**
 * Everything that differs between the two Frigate companions lives here (plus the icons and the
 * wording of README.md and instructions.md). The SHA256 and BLAKE2b packages are otherwise
 * identical, and tools/sync-packages.sh in the frigate-companions project keeps them so.
 */
export const chain = {
  id: 'frigate-sha256-companion',
  title: 'Frigate Electrum Server (SHA256) Companion',
  /** The chain named in the title and on the icon's band. */
  band: 'SHA256',
  packageRepo: 'https://github.com/paulscode/frigate-sha256-companion-startos',
  /** The node this app is named for. Preferred at install when it is installed. */
  pairedNode: 'knots-prerdts',
  /**
   * Preferred external ports, SSL then plaintext. Distinct from the official Frigate's 50002/50001
   * and from the other companion's, so a server running several gets predictable ports.
   */
  sslPort: 50022,
  tcpPort: 50021,
} as const

/**
 * The one sentence every cross-repository report begins and ends with.
 *
 * There are two cross-repository gates in this organisation and they resolve
 * "the code" differently on purpose:
 *
 *   - this one reads `repos/`, the pinned composite;
 *   - mc-compose's `pnpm check:roster` reads the sibling working copies.
 *
 * The split is defensible because the two gates ask different questions. This
 * gate asks whether two pinned revisions agree. The roster gate asks whether
 * a transcription in mc-compose agrees with the working copy it is being
 * edited against.
 */
export const MIRROR_SOURCE_NOTE: ReadonlyArray<string> = [
  'Source: repos/ — the checkout this repository pins in repos.json, NOT the sibling working',
  "copies next to it. mc-compose's `pnpm check:roster` reads those instead, deliberately; the",
  'two gates answer different questions and docs/manifest.md §5.5 says which is which. If the two',
  'disagree, compare the revisions above before believing either.',
]

/** One repository as it actually sat on disk when this run read it. */
export type RepositoryProvenance = {
  readonly name: string
  /** Full SHA of `repos/<name>` HEAD, or `undefined` if it could not be read. */
  readonly head: string | undefined
  /** What `repos.json` names, or `undefined` for an unpinned entry. */
  readonly pinned: string | undefined
  readonly dirty: boolean
}

/** True when what was read is not what the manifest names. */
export const isOffPin = (row: RepositoryProvenance): boolean =>
  row.dirty || row.head === undefined || row.pinned === undefined || row.head !== row.pinned

const shortSha = (sha: string | undefined): string => (sha === undefined ? 'unreadable' : sha.slice(0, 12))

/**
 * Name the revisions this run compared, and flag every one that is not the
 * pin.
 */
export const describeProvenance = (
  rows: ReadonlyArray<RepositoryProvenance>,
): ReadonlyArray<string> => {
  if (rows.length === 0) {
    return [...MIRROR_SOURCE_NOTE, 'No repository under repos/ could be read.']
  }

  const off = rows.filter(isOffPin)
  const lines: Array<string> = [
    ...MIRROR_SOURCE_NOTE,
    `${String(rows.length - off.length)} of ${String(rows.length)} repositories are at the revision repos.json pins.`,
  ]

  if (off.length === 0) {
    return lines
  }

  lines.push(
    `${String(off.length)} are NOT, so this run compared revisions the manifest does not name:`,
  )
  for (const row of off) {
    const dirtySuffix = row.dirty ? '  (uncommitted changes — disk is not any revision)' : ''
    lines.push(
      `    ${row.name}  disk ${shortSha(row.head)}  pinned ${row.pinned === undefined ? 'unpinned' : shortSha(row.pinned)}${dirtySuffix}`,
    )
  }
  lines.push(
    '`pnpm sync` puts repos/ back on the pins; `pnpm update:manifest` records where it actually is.',
  )

  return lines
}

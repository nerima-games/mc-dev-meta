import type { MirrorSpec } from './mirror-model'

/** The stable label used in mirror findings, fingerprints, and CLI output. */
export const mirrorPath = (spec: MirrorSpec): string => `${spec.repository}/${spec.file}`

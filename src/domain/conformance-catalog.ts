export const CONFORMANCE_AUTHORITIES = ['data', 'wiki', 'none'] as const
export type ConformanceAuthority = (typeof CONFORMANCE_AUTHORITIES)[number]

export const CONFORMANCE_STATUSES = ['conformant', 'divergent', 'unverified'] as const
export type ConformanceStatus = (typeof CONFORMANCE_STATUSES)[number]

export type ConformanceSource = {
  readonly location: string
  readonly referencedOn: string
}

export type ConformanceRecord = {
  readonly id: string
  readonly owner: string
  readonly authority: ConformanceAuthority
  readonly source: ConformanceSource
  readonly status: ConformanceStatus
  readonly divergenceReason: string | null
  readonly evidence: ReadonlyArray<string>
}

export type ConformanceIssue = {
  readonly id: string
  readonly code: 'duplicate-id' | 'empty-field' | 'invalid-authority' | 'invalid-status' | 'missing-reason' | 'missing-evidence'
  readonly detail: string
}

const hasValue = <T extends string>(values: ReadonlyArray<T>, value: string): boolean => values.some((entry) => entry === value)

export const CONFORMANCE_CATALOG: ReadonlyArray<ConformanceRecord> = [
  {
    id: 'v4/custom-chunk-format',
    owner: 'mc-dev-meta',
    authority: 'none',
    source: { location: 'docs/portable-chunk.md', referencedOn: '2026-09-29' },
    status: 'divergent',
    divergenceReason: 'The portable chunk contract is intentionally independent of the Java chunk format.',
    evidence: ['test/conformance-catalog.test.ts'],
  },
  {
    id: 'v4/custom-save-format',
    owner: 'mc-dev-meta',
    authority: 'none',
    source: { location: 'docs/responsibility.md', referencedOn: '2026-09-29' },
    status: 'divergent',
    divergenceReason: 'The workspace portable save contract is intentionally independent of Anvil.',
    evidence: ['test/conformance-catalog.test.ts'],
  },
  {
    id: 'v4/bedrock-not-supported',
    owner: 'mc-dev-meta',
    authority: 'none',
    source: { location: 'docs/conformance.md', referencedOn: '2026-09-29' },
    status: 'divergent',
    divergenceReason: 'Conformance is scoped to Minecraft Java Edition 26.3.',
    evidence: ['test/conformance-catalog.test.ts'],
  },
  {
    id: 'v4/reference-extensions',
    owner: 'mc-dev-meta',
    authority: 'none',
    source: { location: 'docs/conformance.md', referencedOn: '2026-09-29' },
    status: 'divergent',
    divergenceReason: 'Features absent from the reference implementation are recorded as extensions, not Java parity.',
    evidence: ['test/conformance-catalog.test.ts'],
  },
  {
    id: 'v4/swiftshader-performance-condition',
    owner: 'mc-dev-meta',
    authority: 'none',
    source: { location: 'docs/conformance.md', referencedOn: '2026-09-29' },
    status: 'divergent',
    divergenceReason: 'SwiftShader-only performance conditions are not treated as Java behavior.',
    evidence: ['test/conformance-catalog.test.ts'],
  },
  {
    id: 'v4/temperature-modifier-derived-values',
    owner: 'mc-dev-meta',
    authority: 'none',
    source: { location: 'docs/conformance.md', referencedOn: '2026-09-29' },
    status: 'divergent',
    divergenceReason: 'Derived values from temperature_modifier are not imitated without an authoritative Java data value.',
    evidence: ['test/conformance-catalog.test.ts'],
  },
]

export const validateConformanceCatalog = (
  records: ReadonlyArray<ConformanceRecord>,
): ReadonlyArray<ConformanceIssue> => {
  const issues: Array<ConformanceIssue> = []
  const ids = new Set<string>()
  for (const record of records) {
    if (record.id.trim().length === 0) issues.push({ id: record.id, code: 'empty-field', detail: 'id must not be empty' })
    if (ids.has(record.id)) issues.push({ id: record.id, code: 'duplicate-id', detail: 'id must be unique' })
    ids.add(record.id)
    if (!hasValue(CONFORMANCE_AUTHORITIES, record.authority)) issues.push({ id: record.id, code: 'invalid-authority', detail: 'unknown authority' })
    if (!hasValue(CONFORMANCE_STATUSES, record.status)) issues.push({ id: record.id, code: 'invalid-status', detail: 'unknown status' })
    if (record.status === 'divergent' && (record.divergenceReason === null || record.divergenceReason.trim().length === 0)) issues.push({ id: record.id, code: 'missing-reason', detail: 'divergent records require a reason' })
    if (record.status === 'conformant' && record.evidence.length === 0) issues.push({ id: record.id, code: 'missing-evidence', detail: 'conformant records require evidence' })
  }
  return issues
}

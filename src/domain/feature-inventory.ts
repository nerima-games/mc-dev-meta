import { FEATURE_INVENTORY } from './feature-catalog'
import { REPOSITORY_NAMES } from './repository-roster'

export const FEATURE_STATUSES = ['implemented', 'partial', 'unimplemented', 'deferred', 'blocked'] as const
export type FeatureStatus = (typeof FEATURE_STATUSES)[number]

export const FEATURE_SCOPES = [
  'kernel-contract',
  'stable-library',
  'foundation',
  'experience',
  'composition',
  'workspace-tooling',
  'portable-contract',
] as const
export type FeatureScope = (typeof FEATURE_SCOPES)[number]

export const FEATURE_EVIDENCE_KINDS = ['source', 'test', 'documentation', 'gate'] as const
export type FeatureEvidenceKind = (typeof FEATURE_EVIDENCE_KINDS)[number]

export const FEATURE_MANAGEMENT = [
  'meta-contract',
  'kernel-canonical',
  'portable-canonical',
  'downstream-runtime',
  'audit-only',
  'blocked',
] as const
export type FeatureManagement = (typeof FEATURE_MANAGEMENT)[number]

export type FeatureEvidence = {
  readonly repository: string
  readonly path: string
  readonly kind: FeatureEvidenceKind
  readonly note: string
}

export type FeatureRecord = {
  readonly id: string
  readonly owner: string
  readonly scope: FeatureScope
  readonly status: FeatureStatus
  readonly summary: string
  readonly management: FeatureManagement
  readonly evidence: ReadonlyArray<FeatureEvidence>
}

export type FeatureInventoryIssueCode =
  | 'duplicate-id'
  | 'empty-id'
  | 'unknown-owner'
  | 'invalid-scope'
  | 'invalid-status'
  | 'invalid-management'
  | 'empty-summary'
  | 'missing-evidence'
  | 'unknown-evidence-repository'
  | 'unsafe-evidence-path'
  | 'invalid-evidence-kind'
  | 'empty-evidence-note'
  | 'management-owner-mismatch'
  | 'blocked-status-mismatch'
  | 'missing-owner'
  | 'implemented-needs-source'
  | 'implemented-needs-validation'

export type FeatureInventoryIssue = {
  readonly code: FeatureInventoryIssueCode
  readonly featureId: string
  readonly detail: string
}

export type FeatureInventoryValidation = {
  readonly ok: boolean
  readonly issues: ReadonlyArray<FeatureInventoryIssue>
}

export type FeatureInventorySummary = {
  readonly total: number
  readonly byStatus: Readonly<Record<FeatureStatus, number>>
  readonly unresolved: ReadonlyArray<string>
  readonly allImplemented: boolean
}

export const summariseFeatureInventory = (
  features: ReadonlyArray<FeatureRecord>,
): FeatureInventorySummary => {
  const byStatus: Record<FeatureStatus, number> = {
    implemented: 0,
    partial: 0,
    unimplemented: 0,
    deferred: 0,
    blocked: 0,
  }
  const unresolved: Array<string> = []

  for (const feature of features) {
    byStatus[feature.status] += 1
    if (feature.status !== 'implemented') {
      unresolved.push(feature.id)
    }
  }

  return {
    total: features.length,
    byStatus,
    unresolved,
    allImplemented: unresolved.length === 0,
  }
}

const hasValue = <T extends string>(values: ReadonlyArray<T>, value: string): value is T => values.includes(value as T)

const isSafeEvidencePath = (value: string): boolean =>
  value.length > 0 &&
  !value.startsWith('/') &&
  !value.includes('\\') &&
  !value.includes(':') &&
  value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')

/**
 * Validate the root-owned feature/ownership catalog without reading the file
 * system. The CLI performs the separate evidence-existence check.
 */
export const validateFeatureInventory = (
  features: ReadonlyArray<FeatureRecord>,
): FeatureInventoryValidation => {
  const issues: Array<FeatureInventoryIssue> = []
  const ids = new Set<string>()
  const owners = new Set<string>()

  const addIssue = (code: FeatureInventoryIssueCode, featureId: string, detail: string): void => {
    issues.push({ code, featureId, detail })
  }

  for (const feature of features) {
    if (feature.id.trim().length === 0) {
      addIssue('empty-id', feature.id, 'feature id must not be empty')
    } else if (ids.has(feature.id)) {
      addIssue('duplicate-id', feature.id, 'feature id must be unique')
    } else {
      ids.add(feature.id)
    }

    owners.add(feature.owner)
    if (!hasValue(REPOSITORY_NAMES, feature.owner)) {
      addIssue('unknown-owner', feature.id, `owner is not in the repository roster: ${feature.owner}`)
    }
    if (!hasValue(FEATURE_SCOPES, feature.scope)) {
      addIssue('invalid-scope', feature.id, `unknown feature scope: ${feature.scope}`)
    }
    if (!hasValue(FEATURE_STATUSES, feature.status)) {
      addIssue('invalid-status', feature.id, `unknown feature status: ${feature.status}`)
    }
    if (!hasValue(FEATURE_MANAGEMENT, feature.management)) {
      addIssue('invalid-management', feature.id, `unknown management policy: ${feature.management}`)
    }
    if (feature.summary.trim().length === 0) {
      addIssue('empty-summary', feature.id, 'feature summary must not be empty')
    }
    if (feature.evidence.length === 0) {
      addIssue('missing-evidence', feature.id, 'at least one evidence entry is required')
    }

    const evidenceKinds = new Set(feature.evidence.map((entry) => entry.kind))
    if (feature.status === 'implemented' && !evidenceKinds.has('source')) {
      addIssue('implemented-needs-source', feature.id, 'implemented features require source evidence')
    }
    if (
      feature.status === 'implemented' &&
      !evidenceKinds.has('test') &&
      !evidenceKinds.has('gate')
    ) {
      addIssue('implemented-needs-validation', feature.id, 'implemented features require test or gate evidence')
    }

    if (feature.management === 'meta-contract' && feature.owner !== 'mc-dev-meta') {
      addIssue('management-owner-mismatch', feature.id, 'meta-contract features must be owned by mc-dev-meta')
    }
    if (feature.management === 'kernel-canonical' && feature.owner !== 'mc-kernel') {
      addIssue('management-owner-mismatch', feature.id, 'kernel-canonical features must be owned by mc-kernel')
    }
    if (feature.management === 'portable-canonical' && feature.owner !== 'mc-dev-meta') {
      addIssue('management-owner-mismatch', feature.id, 'portable-canonical features must be owned by mc-dev-meta')
    }
    if (feature.management === 'blocked' && feature.status !== 'blocked') {
      addIssue('blocked-status-mismatch', feature.id, 'blocked management requires blocked status')
    }

    for (const evidence of feature.evidence) {
      if (!hasValue(REPOSITORY_NAMES, evidence.repository)) {
        addIssue(
          'unknown-evidence-repository',
          feature.id,
          `evidence repository is not in the roster: ${evidence.repository}`,
        )
      }
      if (!isSafeEvidencePath(evidence.path)) {
        addIssue('unsafe-evidence-path', feature.id, `evidence path must be a safe relative file path: ${evidence.path}`)
      }
      if (!hasValue(FEATURE_EVIDENCE_KINDS, evidence.kind)) {
        addIssue('invalid-evidence-kind', feature.id, `unknown evidence kind: ${evidence.kind}`)
      }
      if (evidence.note.trim().length === 0) {
        addIssue('empty-evidence-note', feature.id, 'evidence note must not be empty')
      }
    }
  }

  for (const repository of REPOSITORY_NAMES) {
    if (!owners.has(repository)) {
      addIssue('missing-owner', '', `feature inventory has no entry owned by ${repository}`)
    }
  }

  return { ok: issues.length === 0, issues }
}

export { FEATURE_INVENTORY }

export const FEATURE_INVENTORY_VALIDATION = validateFeatureInventory(FEATURE_INVENTORY)

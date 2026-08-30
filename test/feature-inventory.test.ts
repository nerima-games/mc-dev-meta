import { describe, expect, it } from 'vitest'
import {
  FEATURE_EVIDENCE_KINDS,
  FEATURE_INVENTORY,
  FEATURE_INVENTORY_VALIDATION,
  FEATURE_MANAGEMENT,
  FEATURE_SCOPES,
  FEATURE_STATUSES,
  type FeatureRecord,
  summariseFeatureInventory,
  validateFeatureInventory,
} from '../src/domain/feature-inventory'
import { REPOSITORY_NAMES } from '../src/domain/repository-roster'

const makeFeature = (overrides: Partial<FeatureRecord> = {}): FeatureRecord => ({
  id: 'test/feature',
  owner: 'mc-dev-meta',
  scope: 'workspace-tooling',
  status: 'implemented',
  summary: 'A test feature.',
  management: 'meta-contract',
  evidence: [
    {
      repository: 'mc-dev-meta',
      path: 'src/index.ts',
      kind: 'source',
      note: 'Test evidence.',
    },
    {
      repository: 'mc-dev-meta',
      path: 'test/index.test.ts',
      kind: 'test',
      note: 'Test validation evidence.',
    },
  ],
  ...overrides,
})

describe('feature inventory', () => {
  it('contains a valid entry for every repository', () => {
    expect(FEATURE_INVENTORY.length).toBeGreaterThan(0)
    expect(FEATURE_INVENTORY_VALIDATION).toStrictEqual({ ok: true, issues: [] })
    expect(new Set(FEATURE_INVENTORY.map((feature) => feature.owner))).toEqual(new Set(REPOSITORY_NAMES))
  })

  it('exposes the finite vocabulary used by the catalog', () => {
    expect(FEATURE_STATUSES).toStrictEqual(['implemented', 'partial', 'unimplemented', 'deferred', 'blocked'])
    expect(FEATURE_SCOPES).toContain('kernel-contract')
    expect(FEATURE_SCOPES).toContain('portable-contract')
    expect(FEATURE_EVIDENCE_KINDS).toStrictEqual(['source', 'test', 'documentation', 'gate'])
    expect(FEATURE_MANAGEMENT).toContain('kernel-canonical')
    expect(FEATURE_MANAGEMENT).toContain('portable-canonical')
  })

  it('summarises implemented and unresolved records without changing their order', () => {
    const summary = summariseFeatureInventory([
      makeFeature({ id: 'test/implemented', status: 'implemented' }),
      makeFeature({ id: 'test/partial', status: 'partial' }),
      makeFeature({ id: 'test/unimplemented', status: 'unimplemented' }),
      makeFeature({ id: 'test/deferred', status: 'deferred' }),
      makeFeature({ id: 'test/blocked', status: 'blocked' }),
    ])

    expect(summary).toStrictEqual({
      total: 5,
      byStatus: {
        implemented: 1,
        partial: 1,
        unimplemented: 1,
        deferred: 1,
        blocked: 1,
      },
      unresolved: ['test/partial', 'test/unimplemented', 'test/deferred', 'test/blocked'],
      allImplemented: false,
    })
    expect(summariseFeatureInventory([makeFeature()]).allImplemented).toBe(true)
  })

  it('reports duplicate, missing, and malformed feature metadata', () => {
    const malformed = makeFeature({
      id: '',
      owner: 'not-a-repository',
      scope: 'not-a-scope' as FeatureRecord['scope'],
      status: 'not-a-status' as FeatureRecord['status'],
      summary: '  ',
      management: 'not-a-policy' as FeatureRecord['management'],
      evidence: [
        {
          repository: 'not-a-repository',
          path: '',
          kind: 'not-a-kind' as FeatureRecord['evidence'][number]['kind'],
          note: '  ',
        },
        {
          repository: 'mc-dev-meta',
          path: '/absolute/path',
          kind: 'source',
          note: 'absolute path',
        },
        {
          repository: 'mc-dev-meta',
          path: 'windows\\path',
          kind: 'source',
          note: 'backslash path',
        },
        {
          repository: 'mc-dev-meta',
          path: 'drive:path',
          kind: 'source',
          note: 'colon path',
        },
        {
          repository: 'mc-dev-meta',
          path: './relative',
          kind: 'source',
          note: 'dot path',
        },
        {
          repository: 'mc-dev-meta',
          path: 'empty//segment',
          kind: 'source',
          note: 'empty segment',
        },
        {
          repository: 'mc-dev-meta',
          path: 'parent/../file',
          kind: 'source',
          note: 'parent path',
        },
      ],
    })
    const result = validateFeatureInventory([malformed, makeFeature(), makeFeature()])
    const codes = result.issues.map((issue) => issue.code)

    expect(result.ok).toBe(false)
    expect(codes).toContain('empty-id')
    expect(codes).toContain('duplicate-id')
    expect(codes).toContain('unknown-owner')
    expect(codes).toContain('invalid-scope')
    expect(codes).toContain('invalid-status')
    expect(codes).toContain('invalid-management')
    expect(codes).toContain('empty-summary')
    expect(codes).toContain('unknown-evidence-repository')
    expect(codes).toContain('unsafe-evidence-path')
    expect(codes).toContain('invalid-evidence-kind')
    expect(codes).toContain('empty-evidence-note')
    expect(codes).toContain('missing-owner')
  })

  it('requires evidence and enforces ownership policies', () => {
    const metaMismatch = makeFeature({ owner: 'mc-kernel' })
    const kernelMismatch = makeFeature({ owner: 'mc-dev-meta', management: 'kernel-canonical' })
    const portableMismatch = makeFeature({ owner: 'mc-kernel', management: 'portable-canonical' })
    const blockedMismatch = makeFeature({ management: 'blocked' })
    const noEvidence = makeFeature({ id: 'test/no-evidence', evidence: [] })
    const noSource = makeFeature({
      id: 'test/no-source',
      evidence: [
        {
          repository: 'mc-dev-meta',
          path: 'test/index.test.ts',
          kind: 'test',
          note: 'Validation-only evidence.',
        },
      ],
    })
    const noValidation = makeFeature({
      id: 'test/no-validation',
      evidence: [
        {
          repository: 'mc-dev-meta',
          path: 'src/index.ts',
          kind: 'source',
          note: 'Implementation-only evidence.',
        },
      ],
    })
    const gateValidation = makeFeature({
      id: 'test/gate-validation',
      evidence: [
        {
          repository: 'mc-dev-meta',
          path: 'src/index.ts',
          kind: 'source',
          note: 'Implementation evidence.',
        },
        {
          repository: 'mc-dev-meta',
          path: 'README.md',
          kind: 'gate',
          note: 'Gate validation evidence.',
        },
      ],
    })
    const result = validateFeatureInventory([
      metaMismatch,
      kernelMismatch,
      portableMismatch,
      blockedMismatch,
      noEvidence,
      noSource,
      noValidation,
      gateValidation,
    ])
    const codes = result.issues.map((issue) => issue.code)

    expect(codes.filter((code) => code === 'management-owner-mismatch')).toHaveLength(3)
    expect(codes).toContain('blocked-status-mismatch')
    expect(codes).toContain('missing-evidence')
    expect(codes).toContain('implemented-needs-source')
    expect(codes).toContain('implemented-needs-validation')
  })

  it('accepts a blocked feature when its status agrees', () => {
    const blocked = makeFeature({ id: 'test/blocked', status: 'blocked', management: 'blocked' })
    expect(validateFeatureInventory([blocked]).issues).not.toContainEqual(
      expect.objectContaining({ code: 'blocked-status-mismatch' }),
    )
  })
})

import { describe, expect, it } from 'vitest'

import {
  assessFeature,
  assessFeatures,
  featureAuditExitCode,
  summarizeFeatureAssessments,
  type FeatureSpec,
} from '../src/domain/feature-audit'
import { FEATURE_SPECS } from '../src/domain/feature-register'

const spec = (overrides: Partial<FeatureSpec> = {}): FeatureSpec => ({
  id: 'test.feature',
  owner: 'test-owner',
  title: 'test',
  requiredPaths: ['README.md'],
  implementationMarkers: ['implemented'],
  gapMarkers: ['gap'],
  ...overrides,
})

describe('assessFeature', () => {
  it('classifies a feature with every implementation marker as complete', () => {
    const result = assessFeature(spec(), [{ path: 'README.md', content: 'implemented' }])

    expect(result.status).toBe('complete')
    expect(result.implementedMarkers).toEqual(['implemented'])
    expect(result.missingImplementationMarkers).toEqual([])
    expect(result.gapMarkers).toEqual([])
    expect(result.evidence).toEqual([{ kind: 'implementation', path: 'README.md', marker: 'implemented' }])
  })

  it('classifies a feature with a gap and implementation evidence as partial', () => {
    const result = assessFeature(spec(), [{ path: 'README.md', content: 'implemented gap' }])

    expect(result.status).toBe('partial')
    expect(result.evidence).toEqual([
      { kind: 'implementation', path: 'README.md', marker: 'implemented' },
      { kind: 'gap', path: 'README.md', marker: 'gap' },
    ])
  })

  it('classifies a documented gap without implementation evidence as missing', () => {
    const result = assessFeature(spec(), [{ path: 'README.md', content: 'gap' }])

    expect(result.status).toBe('missing')
    expect(result.missingImplementationMarkers).toEqual(['implemented'])
  })

  it('classifies missing required sources as missing', () => {
    const result = assessFeature(spec({ requiredPaths: ['README.md', 'domain.ts'] }), [
      { path: 'README.md', content: 'implemented' },
    ])

    expect(result.status).toBe('missing')
    expect(result.missingPaths).toEqual(['domain.ts'])
    expect(result.evidence[0]).toEqual({ kind: 'missing-path', path: 'domain.ts' })
  })

  it('classifies partial implementation without a documented gap as partial', () => {
    const result = assessFeature(
      spec({ implementationMarkers: ['implemented', 'second'] }),
      [{ path: 'README.md', content: 'implemented' }],
    )

    expect(result.status).toBe('partial')
    expect(result.missingImplementationMarkers).toEqual(['second'])
  })

  it('classifies available sources without evidence as unverified', () => {
    const result = assessFeature(spec({ implementationMarkers: [], gapMarkers: [] }), [
      { path: 'README.md', content: 'no marker' },
    ])

    expect(result.status).toBe('unverified')
    expect(result.evidence).toEqual([])
  })

  it('does not use markers found outside required paths', () => {
    const result = assessFeature(spec(), [
      { path: 'README.md', content: 'nothing' },
      { path: 'other.md', content: 'implemented gap' },
    ])

    expect(result.status).toBe('unverified')
    expect(result.evidence).toEqual([])
  })
})

describe('feature collection', () => {
  it('assesses repositories by owner and uses an empty source set when absent', () => {
    const assessments = assessFeatures(
      [spec(), spec({ id: 'missing-owner', owner: 'missing' })],
      [{ owner: 'test-owner', sources: [{ path: 'README.md', content: 'implemented' }] }],
    )

    expect(assessments.map((assessment) => assessment.status)).toEqual(['complete', 'missing'])
  })

  it('summarizes all statuses and fails unless every feature is complete', () => {
    const complete = assessFeature(spec(), [{ path: 'README.md', content: 'implemented' }])
    const assessments = [
      complete,
      assessFeature(spec({ id: 'partial' }), [{ path: 'README.md', content: 'implemented gap' }]),
      assessFeature(spec({ id: 'missing' }), [{ path: 'README.md', content: 'gap' }]),
      assessFeature(spec({ id: 'unverified', implementationMarkers: [], gapMarkers: [] }), [
        { path: 'README.md', content: 'none' },
      ]),
    ]

    expect(summarizeFeatureAssessments(assessments)).toEqual({ complete: 1, partial: 1, missing: 1, unverified: 1 })
    expect(featureAuditExitCode(assessments)).toBe(1)
    expect(featureAuditExitCode([complete])).toBe(0)
    expect(featureAuditExitCode([])).toBe(0)
  })

  it('keeps the committed registry unique and owned by managed repositories', () => {
    const ids = FEATURE_SPECS.map((feature) => feature.id)
    const owners = new Set(FEATURE_SPECS.map((feature) => feature.owner))

    expect(new Set(ids).size).toBe(ids.length)
    expect(owners).toEqual(
      new Set([
        'mc-kernel',
        'mc-noise',
        'mc-physics',
        'mc-sim',
        'mc-save',
        'mc-worldgen',
        'mx-gameplay',
        'mx-redstone',
        'mc-meshing',
        'mc-render',
        'mc-audio',
        'mc-compose',
        'mx-multiplayer',
      ]),
    )
  })
})

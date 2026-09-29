import { describe, expect, it } from 'vitest'
import { CONFORMANCE_CATALOG, type ConformanceRecord, validateConformanceCatalog } from '../src/domain/conformance-catalog'

describe('conformance catalog', () => {
  it('contains only valid intentional divergence rows', () => {
    expect(CONFORMANCE_CATALOG.length).toBe(6)
    expect(validateConformanceCatalog(CONFORMANCE_CATALOG)).toStrictEqual([])
    expect(CONFORMANCE_CATALOG.every((record) => record.status === 'divergent')).toBe(true)
  })

  it('requires reasons for divergence and evidence for conformance', () => {
    const first = CONFORMANCE_CATALOG.at(0)
    if (first === undefined) throw new Error('catalog fixture is empty')
    const divergent = { ...first, divergenceReason: null }
    const conformant: ConformanceRecord = { ...first, id: 'test/conformant', status: 'conformant', evidence: [] }
    const issues = validateConformanceCatalog([divergent, conformant])
    expect(issues.map((issue) => issue.code)).toStrictEqual(['missing-reason', 'missing-evidence'])
  })

  it('reports malformed catalog vocabulary and duplicate ids', () => {
    const malformed = JSON.parse('{"id":"","owner":"mc-dev-meta","authority":"bad","source":{"location":"x","referencedOn":"2026-09-29"},"status":"bad","divergenceReason":null,"evidence":[]}')
    const issues = validateConformanceCatalog([malformed, malformed])
    expect(issues.map((issue) => issue.code)).toStrictEqual([
      'empty-field',
      'invalid-authority',
      'invalid-status',
      'empty-field',
      'duplicate-id',
      'invalid-authority',
      'invalid-status',
    ])
  })
})

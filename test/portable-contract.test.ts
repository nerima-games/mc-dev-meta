import { describe, expect, it } from 'vitest'
import {
  describeSkippedPortableContractRun,
  planPortableContractRun,
  portableContractExitCode,
  PORTABLE_CONTRACT_SKIP_REASON,
} from '../src/domain/portable-contract'

describe('a comparison run against a cloned repos/ that found real findings fails', () => {
  it('keeps the caller-provided failures untouched when at least one comparison ran', () => {
    const run = planPortableContractRun(3, ['mc-kernel BLOCK_ID_MAX: expected 4095, received 4094'])

    expect(run.failures).toStrictEqual(['mc-kernel BLOCK_ID_MAX: expected 4095, received 4094'])
    expect(portableContractExitCode(run)).toBe(1)
  })
})

describe('a comparison run against a cloned repos/ that agrees everywhere passes', () => {
  it('leaves no failures and exits 0', () => {
    const run = planPortableContractRun(5, [])

    expect(run.failures).toStrictEqual([])
    expect(portableContractExitCode(run)).toBe(0)
  })
})

describe('zero comparisons against a cloned repos/ is a real finding, not a skip', () => {
  // REGRESSION — the bug this module exists to fix: `check:portable` treated
  // "zero comparisons" as failure unconditionally, which made CI red on a
  // completely uncloned repos/. That case is now handled before this function
  // is ever called (see describeSkippedPortableContractRun below). This test
  // asserts the OTHER half of the split still holds: once repos/ has
  // something cloned into it, a comparison run that still finds nothing to
  // compare stays a failure, because it means something broke rather than
  // that there was nothing to check.
  it('adds "no runtime comparisons performed" to the caller-provided failures', () => {
    const run = planPortableContractRun(0, [])

    expect(run.failures).toStrictEqual(['no runtime comparisons performed'])
    expect(portableContractExitCode(run)).toBe(1)
  })

  it('appends the synthetic failure after any real ones, rather than replacing them', () => {
    const run = planPortableContractRun(0, ['mc-kernel coordinates: repos/mc-kernel/domain/coordinates.ts failed to import: boom'])

    expect(run.failures).toStrictEqual([
      'mc-kernel coordinates: repos/mc-kernel/domain/coordinates.ts failed to import: boom',
      'no runtime comparisons performed',
    ])
    expect(portableContractExitCode(run)).toBe(1)
  })
})

describe('an empty repos/ is a skip, not a failure', () => {
  // REGRESSION — the CI symptom this module exists to fix. In CI `repos/` is
  // never cloned (it is gitignored, like `domain/workspace.ts` documents for
  // every other cross-repository gate), so every comparison this gate could
  // make is necessarily skipped. That must not fail the run.
  it('names repos/ and explains that nothing was cloned', () => {
    const lines = describeSkippedPortableContractRun().join('\n')

    expect(lines).toContain('repos/ is empty')
    expect(lines).toContain('nothing cloned')
  })

  it('explains that this is the normal state of a fresh clone and names the fix', () => {
    const lines = describeSkippedPortableContractRun().join('\n')

    expect(lines).toContain('normal state of a fresh clone')
    expect(lines).toContain('pnpm sync')
  })

  it('prefixes every line with the same "portable contract:" tag the comparison path uses', () => {
    expect(describeSkippedPortableContractRun()[0]).toBe(`portable contract: ${PORTABLE_CONTRACT_SKIP_REASON}`)
  })
})

import { describe, expect, it } from 'vitest'
import { auditPins, type PinObservation } from '../src/domain/pin-audit'

const kernel: PinObservation = {
  name: 'mc-kernel',
  version: '1.3.0',
  packageJson: {},
}

const noise: PinObservation = {
  name: 'mc-noise',
  version: '0.9.0',
  packageJson: { dependencies: { effect: '3.22.1' } },
}

describe('a repository with no @nerima-games/* references', () => {
  it('produces no findings when it declares nothing from the org', () => {
    expect(auditPins([kernel, noise])).toStrictEqual([])
  })

  // REGRESSION: a dependency outside the @nerima-games scope must never be
  // compared against anything — `repositoryNameFromPackageName` has to
  // return undefined and the loop has to skip it rather than treating an
  // arbitrary npm package as an unpinned sibling.
  it('ignores dependencies outside the @nerima-games scope entirely', () => {
    const observation: PinObservation = {
      name: 'mc-worldgen',
      version: '2.0.0',
      packageJson: { dependencies: { effect: '3.22.1', 'left-pad': '^1.3.0' } },
    }
    expect(auditPins([observation, kernel, noise])).toStrictEqual([])
  })
})

describe('a correctly pinned sibling', () => {
  it('produces no finding when the pinned version matches the sibling exactly', () => {
    const downstream: PinObservation = {
      name: 'mc-worldgen',
      version: '2.0.0',
      packageJson: { dependencies: { '@nerima-games/mc-kernel': '1.3.0' } },
    }
    expect(auditPins([downstream, kernel])).toStrictEqual([])
  })
})

describe('a mispinned sibling', () => {
  it('flags a version that does not match the sibling exactly', () => {
    const downstream: PinObservation = {
      name: 'mc-worldgen',
      version: '2.0.0',
      packageJson: { dependencies: { '@nerima-games/mc-kernel': '^1.2.0' } },
    }
    expect(auditPins([downstream, kernel])).toStrictEqual([
      {
        repo: 'mc-worldgen',
        dependency: '@nerima-games/mc-kernel',
        pinned: '^1.2.0',
        current: '1.3.0',
      },
    ])
  })

  // REGRESSION: this is the case a range-parser might be tempted to special
  // case. `workspace:*` never equals a real version string, so the same
  // plain equality check that catches `^1.2.0` catches this too, with no
  // extra code path.
  it('flags a workspace: protocol reference the same way as any other mismatch', () => {
    const downstream: PinObservation = {
      name: 'mc-worldgen',
      version: '2.0.0',
      packageJson: { devDependencies: { '@nerima-games/mc-kernel': 'workspace:*' } },
    }
    expect(auditPins([downstream, kernel])).toStrictEqual([
      {
        repo: 'mc-worldgen',
        dependency: '@nerima-games/mc-kernel',
        pinned: 'workspace:*',
        current: '1.3.0',
      },
    ])
  })
})

describe('a sibling that was not cloned', () => {
  // REGRESSION: "cannot verify" must be a finding, not a silent pass — the
  // same discipline check-mirrors.ts documents as "a check that stays quiet
  // about what it could not verify reports success it has not checked."
  it('flags a reference to a repository absent from the observation set', () => {
    const downstream: PinObservation = {
      name: 'mc-worldgen',
      version: '2.0.0',
      packageJson: { dependencies: { '@nerima-games/mc-save': '1.0.0' } },
    }
    expect(auditPins([downstream])).toStrictEqual([
      {
        repo: 'mc-worldgen',
        dependency: '@nerima-games/mc-save',
        pinned: '1.0.0',
        current: '(not cloned)',
      },
    ])
  })
})

describe('every dependency bucket is checked', () => {
  it('flags a mispin declared under devDependencies', () => {
    const downstream: PinObservation = {
      name: 'mc-worldgen',
      version: '2.0.0',
      packageJson: { devDependencies: { '@nerima-games/mc-kernel': '1.0.0' } },
    }
    expect(auditPins([downstream, kernel])).toStrictEqual([
      { repo: 'mc-worldgen', dependency: '@nerima-games/mc-kernel', pinned: '1.0.0', current: '1.3.0' },
    ])
  })

  it('flags a mispin declared under peerDependencies', () => {
    const downstream: PinObservation = {
      name: 'mc-worldgen',
      version: '2.0.0',
      packageJson: { peerDependencies: { '@nerima-games/mc-kernel': '1.0.0' } },
    }
    expect(auditPins([downstream, kernel])).toStrictEqual([
      { repo: 'mc-worldgen', dependency: '@nerima-games/mc-kernel', pinned: '1.0.0', current: '1.3.0' },
    ])
  })
})

describe('auditPins over the whole workspace', () => {
  it('flattens findings across every observed repository', () => {
    const worldgen: PinObservation = {
      name: 'mc-worldgen',
      version: '2.0.0',
      packageJson: { dependencies: { '@nerima-games/mc-kernel': '9.9.9', '@nerima-games/mc-noise': '0.9.0' } },
    }
    const sim: PinObservation = {
      name: 'mc-sim',
      version: '3.0.0',
      packageJson: { dependencies: { '@nerima-games/mc-worldgen': '1.0.0' } },
    }

    const findings = auditPins([kernel, noise, worldgen, sim])

    expect(findings).toStrictEqual([
      { repo: 'mc-worldgen', dependency: '@nerima-games/mc-kernel', pinned: '9.9.9', current: '1.3.0' },
      { repo: 'mc-sim', dependency: '@nerima-games/mc-worldgen', pinned: '1.0.0', current: '2.0.0' },
    ])
  })

  it('returns an empty array for an empty observation list', () => {
    expect(auditPins([])).toStrictEqual([])
  })
})

/**
 * `src/index.ts` — the public API barrel (docs/public-api.md).
 *
 * Every other test file imports straight from `src/domain/*.ts`, which never
 * exercises the barrel's own `export *` statements, so `src/index.ts` sat at
 * 0% coverage even though every symbol it re-exports is otherwise fully
 * tested. This file's only job is to prove the barrel itself — the surface a
 * consumer would actually import — wires each re-export through correctly,
 * by calling one real function from each of the seven re-exported modules
 * THROUGH THE BARREL and checking a real result.
 */
import { describe, expect, it } from 'vitest'
import {
  describeAction,
  describePinDecision,
  FEATURE_INVENTORY_VALIDATION,
  MANAGED_REPOSITORY_NAMES,
  MANIFEST_VERSION,
  packageNameOf,
  parseManifest,
  planWorkspaceRun,
  UNPINNED,
  blockId,
} from '../src/index'

describe('the public API barrel', () => {
  it('re-exports domain/manifest', () => {
    const raw = JSON.stringify({
      manifestVersion: MANIFEST_VERSION,
      repositories: [{ name: 'mc-kernel', url: 'https://github.com/nerima-games/mc-kernel.git', ref: UNPINNED }],
    })
    const parsed = parseManifest(raw)
    expect(parsed.ok).toBe(true)
  })

  it('re-exports domain/feature-inventory', () => {
    expect(FEATURE_INVENTORY_VALIDATION.ok).toBe(true)
  })

  it('re-exports domain/voxel-chunk', () => {
    expect(blockId(7)).toBe(7)
  })

  it('re-exports domain/pin-plan', () => {
    expect(describePinDecision({ _tag: 'AlreadyPinned', name: 'mc-kernel', ref: 'a'.repeat(40) })).toContain(
      'already pinned',
    )
  })

  it('re-exports domain/repository-roster', () => {
    expect(packageNameOf('mc-kernel')).toBe('@nerima-games/mc-kernel')
    expect(MANAGED_REPOSITORY_NAMES).not.toContain('mc-dev-meta')
  })

  it('re-exports domain/sync-plan', () => {
    expect(
      describeAction({ _tag: 'Clone', name: 'mc-kernel', url: 'https://github.com/nerima-games/mc-kernel.git', ref: UNPINNED }),
    ).toContain('clone')
  })

  it('re-exports domain/workspace', () => {
    const manifest = {
      manifestVersion: MANIFEST_VERSION,
      repositories: [{ name: 'mc-kernel', url: 'https://github.com/nerima-games/mc-kernel.git', ref: UNPINNED }],
    }
    const plan = planWorkspaceRun(manifest, ['mc-kernel'])
    expect(plan.status).toBe('complete')
    expect(plan.targets.map((entry) => entry.name)).toStrictEqual(['mc-kernel'])
  })
})

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseManifest, UNPINNED, type Manifest } from '../src/domain/manifest'
import { MANAGED_REPOSITORY_NAMES } from '../src/domain/repository-roster'
import {
  describeWorkspaceRun,
  MANIFEST_FILENAME,
  planWorkspaceRun,
  REPOS_DIRECTORY,
  WORKSPACE_PACKAGES_GLOB,
} from '../src/domain/workspace'

const SHA = 'a'.repeat(40)

const manifestOf = (entries: ReadonlyArray<readonly [string, string]>): Manifest => {
  const raw = JSON.stringify({
    manifestVersion: 1,
    // A real clone URL, not a placeholder: `parseManifest` validates `url`
    // because git executes some URL forms, so a fixture that would be rejected
    // in production is not a fixture of anything.
    repositories: entries.map(([name, ref]) => ({
      name,
      url: `https://github.com/nerima-games/${name}.git`,
      ref,
    })),
  })
  const parsed = parseManifest(raw)
  if (!parsed.ok) {
    throw new Error('fixture manifest is invalid')
  }
  return parsed.value
}

const threeRepos = manifestOf([
  ['mc-kernel', SHA],
  ['mc-noise', SHA],
  ['mc-save', UNPINNED],
])

describe('an empty workspace is the normal case', () => {
  // REGRESSION — the one that makes this repository verifiable on its own.
  // A fresh clone has an EMPTY repos/ (it is gitignored). If `pnpm verify`
  // required 15 other repositories, the tool that fetches them would be the
  // last thing to become trustworthy — exactly backwards.
  it('reports status "empty" when nothing is cloned', () => {
    const plan = planWorkspaceRun(threeRepos, [])

    expect(plan.status).toBe('empty')
    expect(plan.targets).toStrictEqual([])
    expect(plan.missing).toStrictEqual(['mc-kernel', 'mc-noise', 'mc-save'])
  })

  it('explains what an empty repos/ means and what to do about it', () => {
    const lines = describeWorkspaceRun(planWorkspaceRun(threeRepos, []), 'verify').join('\n')

    expect(lines).toContain('repos/ is empty')
    expect(lines).toContain('normal state of a fresh clone')
    expect(lines).toContain('pnpm sync')
  })

  it('plans no work at all, so a caller can exit 0 without running anything', () => {
    expect(planWorkspaceRun(threeRepos, []).targets).toHaveLength(0)
  })

  it('handles an empty manifest and an empty disk together', () => {
    const plan = planWorkspaceRun(manifestOf([]), [])
    expect(plan.status).toBe('empty')
    expect(plan.missing).toStrictEqual([])
    expect(plan.unmanaged).toStrictEqual([])
  })
})

describe('partial and complete workspaces', () => {
  // Bottom-up construction (plan.md §6 Step 2) means a partial workspace is
  // the normal state for most of the project's life. It is not a failure.
  it('reports status "partial" while the project is being built bottom-up', () => {
    const plan = planWorkspaceRun(threeRepos, ['mc-kernel'])

    expect(plan.status).toBe('partial')
    expect(plan.targets.map((entry) => entry.name)).toStrictEqual(['mc-kernel'])
    expect(plan.missing).toStrictEqual(['mc-noise', 'mc-save'])
  })

  it('reports status "complete" when every managed repository is present', () => {
    const plan = planWorkspaceRun(threeRepos, ['mc-save', 'mc-kernel', 'mc-noise'])

    expect(plan.status).toBe('complete')
    expect(plan.missing).toStrictEqual([])
  })

  it('explains a complete workspace by naming the command and the repository count', () => {
    const plan = planWorkspaceRun(threeRepos, ['mc-save', 'mc-kernel', 'mc-noise'])
    const lines = describeWorkspaceRun(plan, 'verify').join('\n')

    expect(lines).toContain('running "verify" in all 3 repositories')
  })

  // REGRESSION: output order must not depend on readdir order, which differs
  // between filesystems. A workspace run that reports repositories in a
  // different order on macOS and Linux is a diff nobody can read.
  it('runs targets in manifest order, not in directory-listing order', () => {
    const plan = planWorkspaceRun(threeRepos, ['mc-save', 'mc-noise', 'mc-kernel'])
    expect(plan.targets.map((entry) => entry.name)).toStrictEqual([
      'mc-kernel',
      'mc-noise',
      'mc-save',
    ])
  })
})

describe('directories the manifest does not know about', () => {
  // REGRESSION: a stale directory (a rename, an abandoned experiment) must be
  // REPORTED and then LEFT ALONE. Deleting it is exactly the class of act this
  // tool never performs.
  it('reports an unmanaged directory without planning anything for it', () => {
    const plan = planWorkspaceRun(threeRepos, ['mc-kernel', 'mc-renamed-away', 'scratch'])

    expect(plan.unmanaged).toStrictEqual(['mc-renamed-away', 'scratch'])
    expect(plan.targets.map((entry) => entry.name)).toStrictEqual(['mc-kernel'])
  })

  it('says explicitly that unmanaged directories are left alone', () => {
    const lines = describeWorkspaceRun(
      planWorkspaceRun(threeRepos, ['mc-kernel', 'scratch']),
      'verify',
    ).join('\n')

    expect(lines).toContain('left completely alone')
    expect(lines).toContain('remove it yourself')
  })

  it('sorts unmanaged directories so the warning is stable', () => {
    const plan = planWorkspaceRun(threeRepos, ['zzz', 'aaa', 'mc-kernel'])
    expect(plan.unmanaged).toStrictEqual(['aaa', 'zzz'])
  })

  it('pluralises the warning when more than one unmanaged directory is present', () => {
    const lines = describeWorkspaceRun(
      planWorkspaceRun(threeRepos, ['mc-kernel', 'mc-renamed-away', 'scratch']),
      'verify',
    ).join('\n')

    expect(lines).toContain('contains 2 directories not in repos.json')
  })
})

describe('unpinned repositories are reported every run', () => {
  // REGRESSION: `unpinned` is a deliberate sentinel, not a permanent state.
  // Until every entry is pinned, the composite state is not reproducible and a
  // cross-repository regression cannot be bisected — so the reminder is loud
  // and appears on every run rather than once.
  it('lists unpinned entries in the plan', () => {
    expect(planWorkspaceRun(threeRepos, ['mc-kernel']).unpinned).toStrictEqual(['mc-save'])
  })

  it('explains why an unpinned entry matters', () => {
    const lines = describeWorkspaceRun(planWorkspaceRun(threeRepos, ['mc-kernel']), 'verify').join('\n')

    expect(lines).toContain('not reproducible')
    expect(lines).toContain('bisect')
    expect(lines).toContain('pnpm update:manifest')
  })

  it('says nothing when everything is pinned', () => {
    const allPinned = manifestOf([
      ['mc-kernel', SHA],
      ['mc-noise', SHA],
    ])
    const lines = describeWorkspaceRun(planWorkspaceRun(allPinned, ['mc-kernel']), 'verify').join('\n')
    expect(lines).not.toContain('unpinned')
  })
})

describe('the committed workspace configuration', () => {
  const readRoot = (name: string): string => readFileSync(path.join(process.cwd(), name), 'utf8')

  // REGRESSION: the glob is stated in two places — pnpm-workspace.yaml, which
  // pnpm reads, and domain/workspace.ts, which the scripts read. They cannot
  // be allowed to drift.
  it('declares the same packages glob in pnpm-workspace.yaml and in domain/workspace.ts', () => {
    expect(readRoot('pnpm-workspace.yaml')).toContain(`- '${WORKSPACE_PACKAGES_GLOB}'`)
    expect(WORKSPACE_PACKAGES_GLOB).toBe(`${REPOS_DIRECTORY}/*`)
  })

  // REGRESSION: if repos/ were ever committed, this repository would be
  // vendoring 15 repositories into a 16th — undoing the split the whole
  // project exists to make.
  it('gitignores repos/', () => {
    const lines = readRoot('.gitignore')
      .split('\n')
      .map((line) => line.trim())
    expect(lines).toContain(`${REPOS_DIRECTORY}/`)
  })

  it('names the manifest file that is actually committed', () => {
    expect(MANIFEST_FILENAME).toBe('repos.json')
    expect(() => readRoot(MANIFEST_FILENAME)).not.toThrow()
  })

  // REGRESSION: mc-dev-meta must never become a workspace member. It is the
  // tool that fetches the packages, so making it one would mean bootstrapping
  // it from the packages it exists to fetch.
  it('does not list itself as a workspace package', () => {
    const workspace = readRoot('pnpm-workspace.yaml')
    expect(workspace).not.toContain("- '.'")
    expect(workspace).not.toContain('- .')
  })

  it('is marked private, so it can never be published by accident', () => {
    const manifest = JSON.parse(readRoot('package.json')) as {
      readonly private?: boolean
      readonly publishConfig?: unknown
      readonly dependencies?: unknown
    }

    expect(manifest.private).toBe(true)
    expect(manifest.publishConfig).toBeUndefined()
  })

  // REGRESSION: mc-dev-meta has NO runtime dependencies, deliberately. It is
  // the tool that fetches the packages and cannot be bootstrapped from them.
  it('declares no runtime dependencies at all', () => {
    const manifest = JSON.parse(readRoot('package.json')) as { readonly dependencies?: unknown }
    expect(manifest.dependencies).toBeUndefined()
  })

  it('manages exactly the repositories the roster says it manages', () => {
    expect(MANAGED_REPOSITORY_NAMES).toHaveLength(15)
  })
})

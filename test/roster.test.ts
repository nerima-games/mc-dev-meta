import { describe, expect, it } from 'vitest'
import {
  buildOrder,
  defaultCloneUrl,
  DEPENDENCY_GRAPH,
  DEV_ONLY_REPOSITORY,
  KERNEL_REPOSITORY,
  MANAGED_REPOSITORY_NAMES,
  packageNameOf,
  REPOSITORIES,
  REPOSITORY_NAMES,
  repositoriesInTier,
  repositoryNamed,
} from '../src/domain/repository-roster'

describe('the roster', () => {
  it('has all 16 repositories, each exactly once', () => {
    expect(REPOSITORY_NAMES).toHaveLength(16)
    expect(new Set(REPOSITORY_NAMES).size).toBe(16)
  })

  it('manages the 15 game repositories — everything except itself', () => {
    expect(MANAGED_REPOSITORY_NAMES).toHaveLength(15)
    expect(MANAGED_REPOSITORY_NAMES).not.toContain('mc-dev-meta')
    expect(REPOSITORY_NAMES).toContain('mc-dev-meta')
  })

  it('assigns every repository to a tier, with the counts plan.md §2.2 describes', () => {
    expect(repositoriesInTier('stable-library')).toHaveLength(6)
    expect(repositoriesInTier('foundation')).toHaveLength(4)
    expect(repositoriesInTier('experience')).toHaveLength(4)
    expect(repositoriesInTier('composition')).toHaveLength(1)
    expect(repositoriesInTier('workspace-tooling')).toHaveLength(1)
  })

  it('gives every repository a one-line responsibility', () => {
    for (const entry of REPOSITORIES) {
      expect(entry.responsibility.length, entry.name).toBeGreaterThan(0)
    }
  })

  it('derives package names and clone URLs from the repository name', () => {
    expect(packageNameOf('mc-kernel')).toBe('@nerima-games/mc-kernel')
    expect(defaultCloneUrl('mc-kernel')).toBe('https://github.com/nerima-games/mc-kernel.git')
  })

  it('looks up an entry by name', () => {
    expect(repositoryNamed('mc-sim')?.tier).toBe('foundation')
    expect(repositoryNamed('does-not-exist')).toBeUndefined()
  })
})

describe('the dependency graph', () => {
  // REGRESSION: mc-kernel is universally importable, which is expressed by its
  // ABSENCE from every row. Listing it would make every row identical in an
  // uninformative way.
  it('never lists mc-kernel as an edge', () => {
    for (const entry of REPOSITORIES) {
      expect(entry.dependsOn, entry.name).not.toContain(KERNEL_REPOSITORY)
    }
  })

  // REGRESSION: plan.md §2.3-2 / §3.10 — mc-playground-kit is devDependency
  // only. A runtime edge to it would delete input handling from the shipped
  // build, because the runtime input service belongs to mc-render.
  it('never lists mc-playground-kit as a runtime edge, only as a devDependency', () => {
    for (const entry of REPOSITORIES) {
      expect(entry.dependsOn, entry.name).not.toContain(DEV_ONLY_REPOSITORY)
    }

    const devDependants = REPOSITORIES.filter((entry) =>
      entry.devDependsOn.includes(DEV_ONLY_REPOSITORY),
    ).map((entry) => entry.name)

    expect(devDependants).toStrictEqual(['mx-gameplay', 'mx-redstone'])
  })

  // REGRESSION: plan.md §2.3-1 — experience modules do not know one another.
  // "mining puts an item in the inventory" goes through mc-sim's
  // InventoryService, never through an mx-gameplay -> mx-ui import.
  it('records no edge between any two experience modules', () => {
    const experience = repositoriesInTier('experience').map((entry) => entry.name)
    expect(experience).toStrictEqual(['mx-gameplay', 'mx-redstone', 'mx-ui', 'mx-multiplayer'])

    for (const entry of repositoriesInTier('experience')) {
      for (const dependency of entry.dependsOn) {
        expect(experience, `${entry.name} -> ${dependency}`).not.toContain(dependency)
      }
    }
  })

  it('gives mc-kernel and mc-dev-meta no dependencies at all', () => {
    expect(repositoryNamed('mc-kernel')?.dependsOn).toStrictEqual([])
    expect(repositoryNamed('mc-dev-meta')?.dependsOn).toStrictEqual([])
  })

  it('names only known repositories on the right-hand side of every edge', () => {
    for (const entry of REPOSITORIES) {
      for (const dependency of [...entry.dependsOn, ...entry.devDependsOn]) {
        expect(REPOSITORY_NAMES, `${entry.name} -> ${dependency}`).toContain(dependency)
      }
    }
  })

  it('has no cycles: a build order exists', () => {
    const order = buildOrder()
    expect(order).toBeDefined()
    expect(order).toHaveLength(16)
  })

  it('produces a build order in which every repository follows its dependencies', () => {
    const order = buildOrder() ?? []
    for (const [name, dependencies] of DEPENDENCY_GRAPH) {
      for (const dependency of dependencies) {
        expect(order.indexOf(dependency), `${dependency} before ${name}`).toBeLessThan(
          order.indexOf(name),
        )
      }
    }
  })

  // plan.md §6 Step 2: kernel -> noise/meshing/physics/save/audio -> worldgen
  // -> sim -> render -> kit -> gameplay/redstone -> ui -> multiplayer -> compose
  it('agrees with the build order plan.md §6 Step 2 prescribes', () => {
    const order = buildOrder() ?? []
    const at = (name: string): number => order.indexOf(name)

    expect(at('mc-kernel')).toBe(0)
    expect(at('mc-worldgen')).toBeGreaterThan(at('mc-noise'))
    expect(at('mc-sim')).toBeGreaterThan(at('mc-worldgen'))
    expect(at('mc-render')).toBeGreaterThan(at('mc-sim'))
    expect(at('mc-playground-kit')).toBeGreaterThan(at('mc-render'))
    expect(at('mx-gameplay')).toBeGreaterThan(at('mc-sim'))
    expect(at('mc-compose')).toBe(order.length - 1)
  })
})

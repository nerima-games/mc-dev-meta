/** Compare the root portable chunk contract with the checked-out owners. */
import { access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  blockIndex,
  BLOCK_ID_MAX,
  CHUNK_HEIGHT,
  CHUNK_SIZE_XZ,
  CHUNK_VOLUME,
} from '../src/domain/voxel-chunk'
import {
  clampLightLevel,
  createChunkLight,
  createLightGrid,
  getLightAt,
  LIGHT_BYTE_LENGTH,
  LIGHT_LEVEL_MAX,
  LIGHT_LEVEL_MIN,
  setLightAt,
} from '../src/domain/light-grid'

type RuntimeModule = Readonly<Record<string, unknown>>

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const failures: string[] = []
const skipped: string[] = []
const comparisons: string[] = []

const relativePath = (file: string): string => path.relative(repositoryRoot, file)

const loadModule = async (label: string, relative: string): Promise<RuntimeModule | undefined> => {
  const file = path.join(repositoryRoot, relative)
  try {
    await access(file)
  } catch {
    skipped.push(`${label}: ${relative} is absent`)
    return undefined
  }

  try {
    return (await import(pathToFileURL(file).href)) as RuntimeModule
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    failures.push(`${label}: ${relativePath(file)} failed to import: ${detail}`)
    return undefined
  }
}

const numberExport = (module: RuntimeModule, label: string, name: string): number | undefined => {
  const value = module[name]
  if (typeof value !== 'number') {
    failures.push(`${label} does not export numeric ${name}`)
    return undefined
  }
  return value
}

const functionExport = (
  module: RuntimeModule,
  label: string,
  name: string,
): ((...args: unknown[]) => unknown) | undefined => {
  const value = module[name]
  if (typeof value !== 'function') {
    failures.push(`${label} does not export callable ${name}`)
    return undefined
  }
  return value as (...args: unknown[]) => unknown
}

const equalNumber = (label: string, expected: number, actual: number | undefined): void => {
  if (actual !== expected) {
    failures.push(`${label}: expected ${expected}, received ${String(actual)}`)
  } else {
    comparisons.push(label)
  }
}

const equalBytes = (label: string, expected: Uint8Array, actual: unknown): void => {
  const matches =
    actual instanceof Uint8Array &&
    actual.length === expected.length &&
    expected.every((value, index) => actual[index] === value)
  if (!matches) {
    failures.push(`${label}: packed bytes differ`)
  } else {
    comparisons.push(label)
  }
}

const numberResult = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined)

const LIGHT_PROBE_LEVELS = [-Infinity, -3, 0, 0.5, 8.9, 15, 15.9, 20, Infinity] as const

const lightProbeLevel = (voxel: number): number => {
  const level = LIGHT_PROBE_LEVELS[voxel % LIGHT_PROBE_LEVELS.length]
  if (level === undefined) {
    throw new Error('light probe level table must not be empty')
  }
  return level
}

const compareKernel = async (): Promise<void> => {
  const coordinates = await loadModule('mc-kernel coordinates', 'repos/mc-kernel/domain/coordinates.ts')
  const registry = await loadModule('mc-kernel block registry', 'repos/mc-kernel/domain/block-registry.ts')
  if (coordinates !== undefined) {
    equalNumber(
      'mc-kernel CHUNK_SIZE_XZ',
      CHUNK_SIZE_XZ,
      numberExport(coordinates, 'mc-kernel coordinates', 'CHUNK_SIZE_XZ'),
    )
    const makeChunkCoord = functionExport(coordinates, 'mc-kernel coordinates', 'chunkCoord')
    if (makeChunkCoord !== undefined) {
      const candidate = makeChunkCoord(-0, -0)
      if (typeof candidate !== 'object' || candidate === null) {
        failures.push('mc-kernel chunkCoord did not return an object')
      } else {
        const coordinate = candidate as { readonly cx?: unknown; readonly cz?: unknown }
        if (Object.is(coordinate.cx, -0) || Object.is(coordinate.cz, -0)) {
          failures.push('mc-kernel chunkCoord preserves negative zero')
        } else {
          comparisons.push('mc-kernel chunkCoord negative-zero normalization')
        }
      }
    }
  }
  if (registry !== undefined) {
    equalNumber(
      'mc-kernel BLOCK_ID_MAX',
      BLOCK_ID_MAX,
      numberExport(registry, 'mc-kernel block registry', 'BLOCK_ID_MAX'),
    )
    const makeBlockId = functionExport(registry, 'mc-kernel block registry', 'BlockId')
    if (makeBlockId !== undefined) {
      if (makeBlockId(BLOCK_ID_MAX) !== BLOCK_ID_MAX) {
        failures.push('mc-kernel BlockId does not preserve the portable maximum')
      } else {
        comparisons.push('mc-kernel BlockId maximum')
      }
    }
  }
}

const compareWorldgen = async (): Promise<void> => {
  const constants = await loadModule('mc-worldgen constants', 'repos/mc-worldgen/domain/constants.ts')
  if (constants === undefined) {
    return
  }

  equalNumber(
    'mc-worldgen CHUNK_SIZE_XZ',
    CHUNK_SIZE_XZ,
    numberExport(constants, 'mc-worldgen constants', 'CHUNK_SIZE_XZ'),
  )
  equalNumber(
    'mc-worldgen CHUNK_HEIGHT',
    CHUNK_HEIGHT,
    numberExport(constants, 'mc-worldgen constants', 'CHUNK_HEIGHT'),
  )
  equalNumber(
    'mc-worldgen CHUNK_VOLUME',
    CHUNK_VOLUME,
    numberExport(constants, 'mc-worldgen constants', 'CHUNK_VOLUME'),
  )

  const worldgenIndex = functionExport(constants, 'mc-worldgen constants', 'blockIndex')
  if (worldgenIndex !== undefined) {
    let mismatchCount = 0
    let firstMismatch: string | undefined
    for (let x = 0; x < CHUNK_SIZE_XZ; x += 1) {
      for (let z = 0; z < CHUNK_SIZE_XZ; z += 1) {
        for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
          const expected = blockIndex(x, y, z)
          const actual = numberResult(worldgenIndex(x, y, z))
          if (actual !== expected) {
            mismatchCount += 1
            firstMismatch ??= `blockIndex(${x}, ${y}, ${z}): expected ${expected}, received ${String(actual)}`
          }
        }
      }
    }
    if (mismatchCount === 0) {
      comparisons.push(`mc-worldgen blockIndex (${String(CHUNK_VOLUME)} valid coordinates)`)
    } else {
      failures.push(`mc-worldgen blockIndex: ${String(mismatchCount)} mismatches; first ${firstMismatch}`)
    }
  }
}

const compareWorldgenLight = async (): Promise<void> => {
  const light = await loadModule('mc-worldgen light storage', 'repos/mc-worldgen/domain/light.ts')
  if (light === undefined) {
    return
  }

  const kernelProperties = await loadModule(
    'mc-kernel light properties',
    'repos/mc-kernel/domain/block-properties.ts',
  )
  if (kernelProperties !== undefined) {
    equalNumber(
      'mc-worldgen LIGHT_LEVEL_MIN',
      LIGHT_LEVEL_MIN,
      numberExport(kernelProperties, 'mc-kernel light properties', 'LIGHT_LEVEL_MIN'),
    )
    equalNumber(
      'mc-worldgen LIGHT_LEVEL_MAX',
      LIGHT_LEVEL_MAX,
      numberExport(kernelProperties, 'mc-kernel light properties', 'LIGHT_LEVEL_MAX'),
    )

    const kernelClamp = functionExport(kernelProperties, 'mc-kernel light properties', 'clampLightLevel')
    if (kernelClamp !== undefined) {
      for (const value of LIGHT_PROBE_LEVELS) {
        equalNumber(
          `mc-worldgen clampLightLevel(${value})`,
          clampLightLevel(value),
          numberResult(kernelClamp(value)),
        )
      }
    }
  }

  equalNumber(
    'mc-worldgen LIGHT_BYTE_LENGTH',
    LIGHT_BYTE_LENGTH,
    numberExport(light, 'mc-worldgen light storage', 'LIGHT_BYTE_LENGTH'),
  )

  const dependencyEmpty = functionExport(light, 'mc-worldgen light storage', 'emptyChunkLight')
  if (dependencyEmpty !== undefined) {
    const actual = dependencyEmpty()
    if (typeof actual !== 'object' || actual === null) {
      failures.push('mc-worldgen emptyChunkLight did not return an object')
    } else {
      const grids = actual as { readonly sky?: unknown; readonly block?: unknown }
      const expected = createChunkLight()
      equalBytes('mc-worldgen emptyChunkLight sky grid', expected.sky, grids.sky)
      equalBytes('mc-worldgen emptyChunkLight block grid', expected.block, grids.block)
    }
  }

  const dependencyGet = functionExport(light, 'mc-worldgen light storage', 'getLightAt')
  const dependencySet = functionExport(light, 'mc-worldgen light storage', 'setLightAt')
  if (dependencyGet !== undefined && dependencySet !== undefined) {
    const rootGrid = createLightGrid()
    const dependencyGrid = new Uint8Array(LIGHT_BYTE_LENGTH)
    for (let voxel = 0; voxel < CHUNK_VOLUME; voxel += 1) {
      const level = lightProbeLevel(voxel)
      setLightAt(rootGrid, voxel, level)
      dependencySet(dependencyGrid, voxel, level)
    }
    equalBytes(`mc-worldgen packed light grid (${String(CHUNK_VOLUME)} valid voxels)`, rootGrid, dependencyGrid)

    let mismatchCount = 0
    let firstMismatch: string | undefined
    for (let voxel = 0; voxel < CHUNK_VOLUME; voxel += 1) {
      const expected = getLightAt(rootGrid, voxel)
      const actual = numberResult(dependencyGet(dependencyGrid, voxel))
      if (actual !== expected) {
        mismatchCount += 1
        firstMismatch ??= `getLightAt(${voxel}): expected ${expected}, received ${String(actual)}`
      }
    }
    if (mismatchCount === 0) {
      comparisons.push(`mc-worldgen getLightAt (${String(CHUNK_VOLUME)} valid voxels)`)
    } else {
      failures.push(`mc-worldgen getLightAt: ${String(mismatchCount)} mismatches; first ${firstMismatch}`)
    }
  }
}

const main = async (): Promise<void> => {
  await Promise.all([compareKernel(), compareWorldgen(), compareWorldgenLight()])

  if (comparisons.length === 0) {
    failures.push('no runtime comparisons performed')
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      process.stderr.write(`portable contract: ${failure}\n`)
    }
    for (const reason of skipped) {
      process.stderr.write(`portable contract: skipped ${reason}\n`)
    }
    process.exitCode = 1
    return
  }

  process.stdout.write(
    comparisons.length === 0
      ? 'portable contract: no runtime comparisons performed\n'
      : `portable contract: ${comparisons.length} runtime comparisons passed\n`,
  )
  for (const comparison of comparisons) {
    process.stdout.write(`portable contract: passed ${comparison}\n`)
  }
  for (const reason of skipped) {
    process.stdout.write(`portable contract: skipped ${reason}\n`)
  }
}

void main().catch((cause: unknown) => {
  process.stderr.write(`portable contract: unexpected failure: ${cause instanceof Error ? cause.message : String(cause)}\n`)
  process.exitCode = 1
})

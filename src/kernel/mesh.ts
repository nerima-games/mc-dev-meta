import { blockPropertiesOf, blockTypeOf, type BlockId } from './block-registry'
import { getBlockAt, type Chunk } from './chunk'
import type { RenderKind } from './block-properties'
import { CHUNK_SIZE_XZ } from './coordinates'

export const MESH_FACES = ['north', 'south', 'east', 'west', 'up', 'down'] as const
export type MeshFace = (typeof MESH_FACES)[number]

export type MeshVertex = Readonly<{
  x: number
  y: number
  z: number
  ao: number
}>

export type MeshQuad = Readonly<{
  block: BlockId
  kind: RenderKind
  face: MeshFace | 'cross-a' | 'cross-b' | 'surface'
  position: Readonly<{ lx: number; ly: number; lz: number }>
  vertices: ReadonlyArray<MeshVertex>
}>

export type MeshData = Readonly<{
  chunk: Readonly<{ cx: number; cz: number }>
  quads: ReadonlyArray<MeshQuad>
}>

export const ambientOcclusion = (
  sideOneBlocked: boolean,
  sideTwoBlocked: boolean,
  cornerBlocked: boolean,
): number =>
  sideOneBlocked && sideTwoBlocked
    ? 0
    : 3 - Number(sideOneBlocked) - Number(sideTwoBlocked) - Number(cornerBlocked)

type Vec3 = readonly [number, number, number]
type FaceBasis = Readonly<{
  face: MeshFace
  neighbor: Vec3
  origin: Vec3
  axisA: Vec3
  axisB: Vec3
}>

const FACE_BASES: ReadonlyArray<FaceBasis> = [
  { face: 'north', neighbor: [0, 0, -1], origin: [0, 0, 0], axisA: [1, 0, 0], axisB: [0, 1, 0] },
  { face: 'south', neighbor: [0, 0, 1], origin: [1, 0, 1], axisA: [-1, 0, 0], axisB: [0, 1, 0] },
  { face: 'east', neighbor: [1, 0, 0], origin: [1, 0, 1], axisA: [0, 0, -1], axisB: [0, 1, 0] },
  { face: 'west', neighbor: [-1, 0, 0], origin: [0, 0, 0], axisA: [0, 0, 1], axisB: [0, 1, 0] },
  { face: 'up', neighbor: [0, 1, 0], origin: [0, 1, 0], axisA: [1, 0, 0], axisB: [0, 0, 1] },
  { face: 'down', neighbor: [0, -1, 0], origin: [0, 0, 1], axisA: [1, 0, 0], axisB: [0, 0, -1] },
]

type Bounds = Readonly<{
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}>

const FULL_BOUNDS: Bounds = { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 }
const CACTUS_BOUNDS: Bounds = { minX: 1 / 16, maxX: 15 / 16, minY: 0, maxY: 1, minZ: 1 / 16, maxZ: 15 / 16 }
const FLUID_BOUNDS: Bounds = { minX: 0, maxX: 1, minY: 0, maxY: 7 / 8, minZ: 0, maxZ: 1 }

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const multiply = (value: Vec3, scalar: number): Vec3 => [value[0] * scalar, value[1] * scalar, value[2] * scalar]

const localPosition = (
  position: Readonly<{ lx: number; ly: number; lz: number }>,
  offset: Vec3,
): Readonly<{ lx: number; ly: number; lz: number }> => ({
  lx: position.lx + offset[0],
  ly: position.ly + offset[1],
  lz: position.lz + offset[2],
})

const opaqueAt = (chunk: Chunk, position: Readonly<{ lx: number; ly: number; lz: number }>): boolean => {
  const block = getBlockAt(chunk, position)
  const type = block === undefined ? undefined : blockTypeOf(block)
  return type !== undefined && blockPropertiesOf(type).opacity === 'opaque'
}

const visibleFace = (
  chunk: Chunk,
  position: Readonly<{ lx: number; ly: number; lz: number }>,
  basis: FaceBasis,
  kind: RenderKind,
): boolean => {
  const neighbor = getBlockAt(chunk, localPosition(position, basis.neighbor))
  if (neighbor === undefined) {
    return true
  }
  const neighborType = blockTypeOf(neighbor)
  if (neighborType === undefined) {
    return true
  }
  if (blockPropertiesOf(neighborType).opacity === 'opaque') {
    return false
  }
  if (kind === 'fluid') {
    return blockPropertiesOf(neighborType).fluid === 'none'
  }
  return true
}

const scaledVertex = (value: Vec3, bounds: Bounds): Vec3 => [
  bounds.minX + value[0] * (bounds.maxX - bounds.minX),
  bounds.minY + value[1] * (bounds.maxY - bounds.minY),
  bounds.minZ + value[2] * (bounds.maxZ - bounds.minZ),
]

const faceVertex = (
  chunk: Chunk,
  position: Readonly<{ lx: number; ly: number; lz: number }>,
  basis: FaceBasis,
  signA: number,
  signB: number,
  bounds: Bounds,
): MeshVertex => {
  const sideOne = multiply(basis.axisA, signA === 0 ? -1 : 1)
  const sideTwo = multiply(basis.axisB, signB === 0 ? -1 : 1)
  const corner = add(basis.neighbor, add(sideOne, sideTwo))
  const vertex = add(basis.origin, add(multiply(basis.axisA, signA), multiply(basis.axisB, signB)))
  return {
    ...(() => {
      const scaled = scaledVertex(vertex, bounds)
      return { x: scaled[0], y: scaled[1], z: scaled[2] }
    })(),
    ao: ambientOcclusion(
      opaqueAt(chunk, localPosition(position, sideOne)),
      opaqueAt(chunk, localPosition(position, sideTwo)),
      opaqueAt(chunk, localPosition(position, corner)),
    ),
  }
}

const cubeQuads = (
  chunk: Chunk,
  position: Readonly<{ lx: number; ly: number; lz: number }>,
  block: BlockId,
  kind: RenderKind,
  bounds: Bounds,
): ReadonlyArray<MeshQuad> => {
  const quads: Array<MeshQuad> = []
  for (const basis of FACE_BASES) {
    if (!visibleFace(chunk, position, basis, kind)) {
      continue
    }
    quads.push({
      block,
      kind,
      face: basis.face,
      position,
      vertices: [
        faceVertex(chunk, position, basis, 0, 0, bounds),
        faceVertex(chunk, position, basis, 1, 0, bounds),
        faceVertex(chunk, position, basis, 1, 1, bounds),
        faceVertex(chunk, position, basis, 0, 1, bounds),
      ],
    })
  }
  return quads
}

const flatQuad = (
  block: BlockId,
  kind: RenderKind,
  face: 'cross-a' | 'cross-b' | 'surface',
  position: Readonly<{ lx: number; ly: number; lz: number }>,
  vertices: ReadonlyArray<Readonly<{ x: number; y: number; z: number }>>,
): MeshQuad => ({
  block,
  kind,
  face,
  position,
  vertices: vertices.map((vertex) => ({ ...vertex, ao: 3 })),
})

const specialQuads = (
  block: BlockId,
  kind: RenderKind,
  position: Readonly<{ lx: number; ly: number; lz: number }>,
): ReadonlyArray<MeshQuad> => {
  if (kind === 'cross') {
    return [
      flatQuad(block, kind, 'cross-a', position, [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 1 },
        { x: 1, y: 0, z: 1 },
        { x: 0, y: 1, z: 0 },
      ]),
      flatQuad(block, kind, 'cross-b', position, [
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 1 },
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 1, z: 0 },
      ]),
    ]
  }
  if (kind === 'rail') {
    return [
      flatQuad(block, kind, 'surface', position, [
        { x: 0, y: 1 / 16, z: 0 },
        { x: 1, y: 1 / 16, z: 0 },
        { x: 1, y: 1 / 16, z: 1 },
        { x: 0, y: 1 / 16, z: 1 },
      ]),
    ]
  }
  if (kind === 'lilyPad') {
    return [
      flatQuad(block, kind, 'surface', position, [
        { x: 1 / 16, y: 1 / 16, z: 1 / 16 },
        { x: 15 / 16, y: 1 / 16, z: 1 / 16 },
        { x: 15 / 16, y: 1 / 16, z: 15 / 16 },
        { x: 1 / 16, y: 1 / 16, z: 15 / 16 },
      ]),
    ]
  }
  return []
}

const quadsForBlock = (
  chunk: Chunk,
  position: Readonly<{ lx: number; ly: number; lz: number }>,
  block: BlockId,
  kind: RenderKind,
): ReadonlyArray<MeshQuad> => {
  if (kind === 'none') {
    return []
  }
  if (kind === 'cross' || kind === 'rail' || kind === 'lilyPad') {
    return specialQuads(block, kind, position)
  }
  if (kind === 'cactus') {
    return cubeQuads(chunk, position, block, kind, CACTUS_BOUNDS)
  }
  if (kind === 'fluid') {
    return cubeQuads(chunk, position, block, kind, FLUID_BOUNDS)
  }
  return cubeQuads(chunk, position, block, kind, FULL_BOUNDS)
}

export const meshChunk = (chunk: Chunk): MeshData => {
  const quads: Array<MeshQuad> = []
  for (let ly = chunk.bounds.minY; ly < chunk.bounds.maxYExclusive; ly += 1) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
      for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
        const position = { lx, ly, lz }
        const block = getBlockAt(chunk, position)
        const type = block === undefined ? undefined : blockTypeOf(block)
        if (block === undefined || type === undefined) {
          continue
        }
        quads.push(...quadsForBlock(chunk, position, block, blockPropertiesOf(type).renderKind))
      }
    }
  }
  return { chunk: { cx: chunk.position.cx, cz: chunk.position.cz }, quads }
}

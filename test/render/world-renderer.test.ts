import { describe, expect, it } from 'vitest'
import { blockIdOf } from '../../src/kernel/block-registry'
import { createChunk, createChunkBounds } from '../../src/kernel/chunk'
import { chunkCoord } from '../../src/kernel/coordinates'
import {
  NO_RENDER_BACKEND,
  WorldRenderer,
  type RenderBackend,
} from '../../src/render/world-renderer'

const bounds = createChunkBounds(0, 1)
if (bounds === undefined) {
  throw new Error('test bounds must be valid')
}

const chunk = (cx: number, cz: number) => createChunk(
  chunkCoord(cx, cz),
  bounds,
  blockIdOf('stone'),
)

describe('world renderer', () => {
  it('tracks chunks, renders meshes, resizes, and removes chunks', () => {
    const draws: Array<{ time: number; meshCount: number; quadCount: number }> = []
    const resizes: Array<Readonly<{ width: number; height: number }>> = []
    let disposeCount = 0
    const backend: RenderBackend = {
      draw: (frame, meshes) => draws.push({
        time: frame.time,
        meshCount: meshes.length,
        quadCount: meshes.reduce((total, mesh) => total + mesh.quads.length, 0),
      }),
      resize: (width, height) => resizes.push({ width, height }),
      dispose: () => { disposeCount += 1 },
    }
    const renderer = new WorldRenderer(backend)
    const first = chunk(0, 0)
    const second = chunk(1, 0)

    expect(renderer.state).toBe('active')
    expect(renderer.chunkCount).toBe(0)
    renderer.setChunk(first)
    renderer.updateChunk(first)
    renderer.setChunk(second)
    expect(renderer.chunkCount).toBe(2)

    expect(renderer.render({ camera: { x: 0, y: 1, z: 2 }, time: 3 })).toEqual({
      chunkCount: 2,
      quadCount: 1152,
    })
    expect(draws).toEqual([{ time: 3, meshCount: 2, quadCount: 1152 }])

    renderer.resize(800, 600)
    expect(resizes).toEqual([{ width: 800, height: 600 }])
    expect(renderer.removeChunk(chunkCoord(1, 0))).toBe(true)
    expect(renderer.removeChunk(chunkCoord(1, 0))).toBe(false)
    expect(renderer.chunkCount).toBe(1)
  })

  it('rejects invalid frame and viewport values', () => {
    const renderer = new WorldRenderer()
    const frame = { camera: { x: 0, y: 0, z: 0 }, time: 0 }
    expect(() => renderer.render({ ...frame, time: Number.NaN })).toThrow(RangeError)
    expect(() => renderer.render({ ...frame, time: Number.POSITIVE_INFINITY })).toThrow(RangeError)
    expect(() => renderer.resize(Number.NaN, 1)).toThrow(RangeError)
    expect(() => renderer.resize(0, 1)).toThrow(RangeError)
    expect(() => renderer.resize(1, -1)).toThrow(RangeError)
    expect(() => renderer.resize(1, Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })

  it('disposes once and rejects further lifecycle operations', () => {
    let disposeCount = 0
    const backend: RenderBackend = {
      draw: () => undefined,
      resize: () => undefined,
      dispose: () => { disposeCount += 1 },
    }
    const renderer = new WorldRenderer(backend)
    renderer.setChunk(chunk(0, 0))
    renderer.dispose()
    renderer.dispose()

    expect(renderer.state).toBe('disposed')
    expect(renderer.chunkCount).toBe(0)
    expect(disposeCount).toBe(1)
    expect(() => renderer.setChunk(chunk(0, 0))).toThrow('disposed')
    expect(() => renderer.updateChunk(chunk(0, 0))).toThrow('disposed')
    expect(() => renderer.removeChunk(chunkCoord(0, 0))).toThrow('disposed')
    expect(() => renderer.render({ camera: { x: 0, y: 0, z: 0 }, time: 0 })).toThrow('disposed')
    expect(() => renderer.resize(1, 1)).toThrow('disposed')
  })

  it('provides a no-op backend for headless callers', () => {
    const renderer = new WorldRenderer(NO_RENDER_BACKEND)
    expect(renderer.render({ camera: { x: 0, y: 0, z: 0 }, time: 0 })).toEqual({
      chunkCount: 0,
      quadCount: 0,
    })
    expect(() => renderer.resize(1, 1)).not.toThrow()
    expect(() => renderer.dispose()).not.toThrow()
  })
})

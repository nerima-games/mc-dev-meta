import { chunkKey, type ChunkCoord } from '../kernel/coordinates'
import { meshChunk, type MeshData } from '../kernel/mesh'
import type { Chunk } from '../kernel/chunk'

export type RenderCamera = Readonly<{
  x: number
  y: number
  z: number
}>

export type RenderFrame = Readonly<{
  camera: RenderCamera
  time: number
}>

export type RenderBackend = Readonly<{
  draw: (frame: RenderFrame, meshes: ReadonlyArray<MeshData>) => void
  resize: (width: number, height: number) => void
  dispose: () => void
}>

export type RenderReport = Readonly<{
  chunkCount: number
  quadCount: number
}>

export const NO_RENDER_BACKEND: RenderBackend = {
  draw: () => undefined,
  resize: () => undefined,
  dispose: () => undefined,
}

const ensureFinite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite`)
  }
}

const ensurePositive = (value: number, label: string): void => {
  ensureFinite(value, label)
  if (value <= 0) {
    throw new RangeError(`${label} must be positive`)
  }
}

export class WorldRenderer {
  private readonly meshes = new Map<string, MeshData>()
  private disposed = false

  public constructor(private readonly backend: RenderBackend = NO_RENDER_BACKEND) {}

  public get chunkCount(): number {
    return this.meshes.size
  }

  public get state(): 'active' | 'disposed' {
    return this.disposed ? 'disposed' : 'active'
  }

  public setChunk(chunk: Chunk): void {
    this.ensureActive()
    this.meshes.set(chunkKey(chunk.position), meshChunk(chunk))
  }

  public updateChunk(chunk: Chunk): void {
    this.setChunk(chunk)
  }

  public removeChunk(position: ChunkCoord): boolean {
    this.ensureActive()
    return this.meshes.delete(chunkKey(position))
  }

  public render(frame: RenderFrame): RenderReport {
    this.ensureActive()
    ensureFinite(frame.time, 'frame.time')
    const meshes = [...this.meshes.values()]
    this.backend.draw(frame, meshes)
    let quadCount = 0
    for (const mesh of meshes) {
      quadCount += mesh.quads.length
    }
    return { chunkCount: meshes.length, quadCount }
  }

  public resize(width: number, height: number): void {
    this.ensureActive()
    ensurePositive(width, 'width')
    ensurePositive(height, 'height')
    this.backend.resize(width, height)
  }

  public dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.meshes.clear()
    this.backend.dispose()
  }

  private ensureActive(): void {
    if (this.disposed) {
      throw new Error('WorldRenderer is disposed')
    }
  }
}

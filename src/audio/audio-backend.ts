export const AUDIO_AVAILABILITIES = ['unavailable', 'locked', 'ready'] as const
export type AudioAvailability = (typeof AUDIO_AVAILABILITIES)[number]

export const AUDIO_WAVES = ['sine', 'square', 'sawtooth', 'triangle'] as const
export type AudioWave = (typeof AUDIO_WAVES)[number]

export type ToneRequest = Readonly<{
  soundId?: string
  playbackRate?: number
  frequency: number
  wave?: AudioWave
  durationSecs: number
  gain: number
  pan: number
  loop: boolean
  stream?: boolean
  naturalDuration?: boolean
  sampleOnly?: boolean
}>

export type MusicRequest = Readonly<{
  soundId: string
  gain: number
  playbackRate: number
  stream: boolean
}>

export type AudioHandle = Readonly<{ id: number }>

export type AudioSurfaceState = 'suspended' | 'running' | 'closed'

export type AudioOutputSurface = Readonly<{
  state: AudioSurfaceState
  resume: () => Promise<void>
  playTone: (request: ToneRequest, masterGain: number, handle: AudioHandle) => void
  playMusic: (request: MusicRequest, masterGain: number, handle: AudioHandle) => void
  stop: (handle: AudioHandle) => void
  setMasterGain: (gain: number) => void
}>

export interface AudioBackendPort {
  readonly availability: AudioAvailability
  unlock: () => Promise<AudioAvailability>
  playTone: (request: ToneRequest) => AudioHandle | undefined
  playMusic: (request: MusicRequest) => AudioHandle | undefined
  stop: (handle: AudioHandle) => boolean
  setMasterGain: (gain: number) => void
  isActive: (handle: AudioHandle) => boolean
}

const availabilityOf = (state: AudioSurfaceState): AudioAvailability => {
  if (state === 'closed') {
    return 'unavailable'
  }
  return state === 'suspended' ? 'locked' : 'ready'
}

const isFiniteInRange = (value: number, min: number, max: number): boolean =>
  Number.isFinite(value) && value >= min && value <= max

const validToneRequest = (request: ToneRequest): boolean =>
  isFiniteInRange(request.frequency, 0, Number.MAX_SAFE_INTEGER) &&
  isFiniteInRange(request.durationSecs, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER) &&
  isFiniteInRange(request.gain, 0, 1) &&
  isFiniteInRange(request.pan, -1, 1) &&
  (request.playbackRate === undefined ||
    isFiniteInRange(request.playbackRate, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER)) &&
  (request.soundId === undefined || request.soundId.length > 0) &&
  (request.wave === undefined || AUDIO_WAVES.includes(request.wave))

const validMusicRequest = (request: MusicRequest): boolean =>
  request.soundId.length > 0 &&
  isFiniteInRange(request.gain, 0, 1) &&
  isFiniteInRange(request.playbackRate, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER)

const ensureGain = (gain: number): void => {
  if (!isFiniteInRange(gain, 0, 1)) {
    throw new RangeError('master gain must be finite and in [0, 1]')
  }
}

export class WebAudioBackend implements AudioBackendPort {
  private availabilityState: AudioAvailability
  private masterGain = 1
  private nextId = 1
  private readonly active = new Map<number, AudioHandle>()

  public constructor(private readonly surface: AudioOutputSurface) {
    this.availabilityState = availabilityOf(surface.state)
  }

  public get availability(): AudioAvailability {
    return this.availabilityState
  }

  public async unlock(): Promise<AudioAvailability> {
    if (this.availabilityState === 'unavailable' || this.availabilityState === 'ready') {
      return this.availabilityState
    }
    try {
      await this.surface.resume()
      this.availabilityState = 'ready'
    } catch {
      this.availabilityState = 'unavailable'
    }
    return this.availabilityState
  }

  public playTone(request: ToneRequest): AudioHandle | undefined {
    if (this.availabilityState !== 'ready' || !validToneRequest(request)) {
      return undefined
    }
    const handle = this.allocateHandle()
    this.surface.playTone(request, this.masterGain, handle)
    return handle
  }

  public playMusic(request: MusicRequest): AudioHandle | undefined {
    if (this.availabilityState !== 'ready' || !validMusicRequest(request)) {
      return undefined
    }
    const handle = this.allocateHandle()
    this.surface.playMusic(request, this.masterGain, handle)
    return handle
  }

  public stop(handle: AudioHandle): boolean {
    const active = this.active.get(handle.id)
    if (active === undefined) {
      return false
    }
    this.surface.stop(active)
    this.active.delete(handle.id)
    return true
  }

  public setMasterGain(gain: number): void {
    ensureGain(gain)
    this.masterGain = gain
    this.surface.setMasterGain(gain)
  }

  public isActive(handle: AudioHandle): boolean {
    return this.active.has(handle.id)
  }

  public dispose(): void {
    for (const handle of this.active.values()) {
      this.surface.stop(handle)
    }
    this.active.clear()
    this.availabilityState = 'unavailable'
  }

  private allocateHandle(): AudioHandle {
    const handle = { id: this.nextId }
    this.nextId += 1
    this.active.set(handle.id, handle)
    return handle
  }
}

import { describe, expect, it } from 'vitest'
import {
  AUDIO_WAVES,
  WebAudioBackend,
  type AudioHandle,
  type AudioOutputSurface,
  type AudioSurfaceState,
  type MusicRequest,
  type ToneRequest,
} from '../../src/audio/audio-backend'

type SurfaceFixture = {
  readonly surface: AudioOutputSurface
  readonly tones: Array<{ request: ToneRequest; masterGain: number; handle: AudioHandle }>
  readonly music: Array<{ request: MusicRequest; masterGain: number; handle: AudioHandle }>
  readonly stopped: AudioHandle[]
  readonly masterGains: number[]
  readonly resumeCalls: number
}

const surfaceOf = (
  state: AudioSurfaceState,
  resume: () => Promise<void> = async () => undefined,
): SurfaceFixture => {
  const tones: Array<{ request: ToneRequest; masterGain: number; handle: AudioHandle }> = []
  const music: Array<{ request: MusicRequest; masterGain: number; handle: AudioHandle }> = []
  const stopped: AudioHandle[] = []
  const masterGains: number[] = []
  let resumeCalls = 0

  return {
    surface: {
      state,
      resume: async () => {
        resumeCalls += 1
        await resume()
      },
      playTone: (request, masterGain, handle) => {
        tones.push({ request, masterGain, handle })
      },
      playMusic: (request, masterGain, handle) => {
        music.push({ request, masterGain, handle })
      },
      stop: (handle) => {
        stopped.push(handle)
      },
      setMasterGain: (gain) => {
        masterGains.push(gain)
      },
    },
    tones,
    music,
    stopped,
    masterGains,
    get resumeCalls() {
      return resumeCalls
    },
  }
}

const tone: ToneRequest = {
  frequency: 440,
  durationSecs: 1,
  gain: 0.5,
  pan: 0,
  loop: false,
}

const music: MusicRequest = {
  soundId: 'music.theme',
  gain: 0.5,
  playbackRate: 1,
  stream: true,
}

describe('WebAudioBackend', () => {
  it('reports availability and unlocks suspended surfaces', async () => {
    const unavailable = new WebAudioBackend(surfaceOf('closed').surface)
    expect(unavailable.availability).toBe('unavailable')
    expect(await unavailable.unlock()).toBe('unavailable')

    const readyFixture = surfaceOf('running')
    const ready = new WebAudioBackend(readyFixture.surface)
    expect(ready.availability).toBe('ready')
    expect(await ready.unlock()).toBe('ready')
    expect(readyFixture.resumeCalls).toBe(0)

    const lockedFixture = surfaceOf('suspended')
    const locked = new WebAudioBackend(lockedFixture.surface)
    expect(locked.availability).toBe('locked')
    expect(await locked.unlock()).toBe('ready')
    expect(lockedFixture.resumeCalls).toBe(1)
    expect(await locked.unlock()).toBe('ready')
    expect(lockedFixture.resumeCalls).toBe(1)
  })

  it('falls back to unavailable when a suspended surface cannot resume', async () => {
    const fixture = surfaceOf('suspended', async () => {
      throw new Error('blocked')
    })
    const backend = new WebAudioBackend(fixture.surface)

    expect(await backend.unlock()).toBe('unavailable')
    expect(backend.availability).toBe('unavailable')
    expect(await backend.unlock()).toBe('unavailable')
    expect(fixture.resumeCalls).toBe(1)
  })

  it('plays valid tones and music with stable handles', () => {
    const fixture = surfaceOf('running')
    const backend = new WebAudioBackend(fixture.surface)

    const first = backend.playTone(tone)
    const second = backend.playMusic(music)
    const configured = backend.playTone({
      ...tone,
      soundId: 'step',
      playbackRate: 1.25,
      wave: 'triangle',
      naturalDuration: true,
      sampleOnly: true,
      stream: true,
    })

    expect(first).toEqual({ id: 1 })
    expect(second).toEqual({ id: 2 })
    expect(configured).toEqual({ id: 3 })
    expect(fixture.tones).toHaveLength(2)
    expect(fixture.tones.map(({ handle }) => handle.id)).toEqual([1, 3])
    expect(fixture.music).toEqual([{ request: music, masterGain: 1, handle: { id: 2 } }])
    expect(backend.isActive({ id: 1 })).toBe(true)
    expect(backend.isActive({ id: 999 })).toBe(false)
  })

  it('rejects playback while locked or when requests are invalid', () => {
    const locked = new WebAudioBackend(surfaceOf('suspended').surface)
    expect(locked.playTone(tone)).toBeUndefined()
    expect(locked.playMusic(music)).toBeUndefined()

    const fixture = surfaceOf('running')
    const backend = new WebAudioBackend(fixture.surface)
    const rejectTone = (request: ToneRequest): void => {
      expect(backend.playTone(request)).toBeUndefined()
    }
    const rejectMusic = (request: MusicRequest): void => {
      expect(backend.playMusic(request)).toBeUndefined()
    }

    for (const frequency of [Number.NaN, Number.POSITIVE_INFINITY, -1, Number.MAX_SAFE_INTEGER + 1]) {
      rejectTone({ ...tone, frequency })
    }
    for (const durationSecs of [0, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      rejectTone({ ...tone, durationSecs })
    }
    for (const gain of [-1, 2, Number.NaN]) {
      rejectTone({ ...tone, gain })
    }
    for (const pan of [-2, 2, Number.NaN]) {
      rejectTone({ ...tone, pan })
    }
    for (const playbackRate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      rejectTone({ ...tone, playbackRate })
    }
    rejectTone({ ...tone, soundId: '' })
    rejectTone({ ...tone, wave: 'noise' as never })

    rejectMusic({ ...music, soundId: '' })
    for (const gain of [-1, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
      rejectMusic({ ...music, gain })
    }
    for (const playbackRate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      rejectMusic({ ...music, playbackRate })
    }
    expect(fixture.tones).toHaveLength(0)
    expect(fixture.music).toHaveLength(0)
  })

  it('accepts every wave and optional request branch', () => {
    const fixture = surfaceOf('running')
    const backend = new WebAudioBackend(fixture.surface)

    for (const wave of AUDIO_WAVES) {
      expect(backend.playTone({ ...tone, wave })).toBeDefined()
    }

    expect(fixture.tones.map(({ request }) => request.wave)).toEqual([...AUDIO_WAVES])
  })

  it('stops active handles, controls master gain, and disposes idempotently', () => {
    const fixture = surfaceOf('running')
    const backend = new WebAudioBackend(fixture.surface)
    const toneHandle = backend.playTone(tone)
    const musicHandle = backend.playMusic(music)

    expect(toneHandle).toBeDefined()
    expect(musicHandle).toBeDefined()
    expect(backend.stop({ id: 999 })).toBe(false)
    expect(backend.stop(toneHandle as AudioHandle)).toBe(true)
    expect(backend.stop(toneHandle as AudioHandle)).toBe(false)
    expect(fixture.stopped).toEqual([{ id: 1 }])

    backend.setMasterGain(0)
    backend.setMasterGain(1)
    expect(() => backend.setMasterGain(-1)).toThrow(RangeError)
    expect(() => backend.setMasterGain(2)).toThrow(RangeError)
    expect(() => backend.setMasterGain(Number.NaN)).toThrow(RangeError)
    expect(fixture.masterGains).toEqual([0, 1])

    backend.dispose()
    backend.dispose()
    expect(fixture.stopped).toEqual([{ id: 1 }, { id: 2 }])
    expect(backend.availability).toBe('unavailable')
    expect(backend.isActive({ id: 2 })).toBe(false)
    expect(backend.playTone(tone)).toBeUndefined()
  })
})

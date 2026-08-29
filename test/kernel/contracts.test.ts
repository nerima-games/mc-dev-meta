import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  FixedClockLayer,
  fixedClock,
  monotonicSecs,
  wallClockEpochMillis,
} from '../../src/kernel/clock'
import { snapshotAgeSecs, type CameraPoseSnapshot } from '../../src/kernel/camera'
import { type GameModule, type StageRegistration } from '../../src/kernel/frame'
import { StageId, WorldId } from '../../src/kernel/identifiers'
import {
  DeltaTimeSecs,
  EpochMillis,
  MonotonicTimeSecs,
  StackCount,
} from '../../src/kernel/quantities'
import { position } from '../../src/kernel/coordinates'

const FIXED_TIME = {
  monotonicSecs: MonotonicTimeSecs(1234.5),
  wallClockEpochMillis: EpochMillis(1_725_000_000_000),
}

describe('kernel runtime contracts', () => {
  it('validates non-empty identifiers', () => {
    expect(WorldId('overworld')).toBe('overworld')
    expect(StageId('simulation')).toBe('simulation')
    expect(() => WorldId('')).toThrow()
    expect(() => StageId('   ')).toThrow()
  })

  it('validates bounded quantities and time values', () => {
    expect(StackCount(0)).toBe(0)
    expect(StackCount(64)).toBe(64)
    expect(() => StackCount(-1)).toThrow()
    expect(() => StackCount(1.5)).toThrow()
    expect(() => StackCount(65)).toThrow()

    expect(DeltaTimeSecs(0)).toBe(0)
    expect(() => DeltaTimeSecs(-0.1)).toThrow()
    expect(() => DeltaTimeSecs(Number.POSITIVE_INFINITY)).toThrow()

    expect(MonotonicTimeSecs(0)).toBe(0)
    expect(() => MonotonicTimeSecs(-1)).toThrow()
    expect(() => MonotonicTimeSecs(Number.NaN)).toThrow()

    expect(EpochMillis(0)).toBe(0)
    expect(() => EpochMillis(1.5)).toThrow()
    expect(() => EpochMillis(Number.MAX_SAFE_INTEGER + 1)).toThrow()
  })

  it('provides deterministic clock services', () => {
    const clock = fixedClock(FIXED_TIME)
    expect(Effect.runSync(clock.monotonicSecs)).toBe(FIXED_TIME.monotonicSecs)
    expect(Effect.runSync(clock.wallClockEpochMillis)).toBe(FIXED_TIME.wallClockEpochMillis)
    expect(Effect.runSync(monotonicSecs.pipe(Effect.provide(FixedClockLayer(FIXED_TIME))))).toBe(
      FIXED_TIME.monotonicSecs,
    )
    expect(
      Effect.runSync(wallClockEpochMillis.pipe(Effect.provide(FixedClockLayer(FIXED_TIME)))),
    ).toBe(FIXED_TIME.wallClockEpochMillis)
  })

  it('computes camera snapshot age from monotonic time', () => {
    const snapshot: CameraPoseSnapshot = {
      position: position(1, 2, 3),
      yawRadians: 0.25,
      pitchRadians: -0.5,
      capturedAtSecs: MonotonicTimeSecs(10),
    }
    expect(snapshotAgeSecs(snapshot, MonotonicTimeSecs(12.5))).toBe(2.5)
    expect(snapshotAgeSecs(snapshot, MonotonicTimeSecs(10))).toBe(0)
    expect(snapshotAgeSecs(snapshot, MonotonicTimeSecs(5))).toBe(-5)
  })

  it('describes frame stages without runtime coupling', () => {
    const stage: StageRegistration = {
      id: StageId('simulation'),
      after: [StageId('input')],
      run: () => Effect.void,
    }
    const module: GameModule<never, never, never> = {
      layers: Layer.empty,
      frameStages: Effect.succeed([stage]),
    }
    expect(Effect.runSync(module.frameStages)).toStrictEqual([stage])
    expect(stage.run(DeltaTimeSecs(0))).toBe(Effect.void)
  })
})

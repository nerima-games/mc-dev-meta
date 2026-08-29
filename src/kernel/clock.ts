import { Context, Effect, Layer } from 'effect'
import type { EpochMillis, MonotonicTimeSecs } from './quantities'

export type ClockService = {
  readonly monotonicSecs: Effect.Effect<MonotonicTimeSecs>
  readonly wallClockEpochMillis: Effect.Effect<EpochMillis>
}

export class ClockPort extends Context.Tag('@nerima-games/mc-kernel/ClockPort')<
  ClockPort,
  ClockService
>() {}

export const fixedClock = (at: {
  readonly monotonicSecs: MonotonicTimeSecs
  readonly wallClockEpochMillis: EpochMillis
}): ClockService => ({
  monotonicSecs: Effect.succeed(at.monotonicSecs),
  wallClockEpochMillis: Effect.succeed(at.wallClockEpochMillis),
})

export const FixedClockLayer = (at: {
  readonly monotonicSecs: MonotonicTimeSecs
  readonly wallClockEpochMillis: EpochMillis
}): Layer.Layer<ClockPort> => Layer.succeed(ClockPort, fixedClock(at))

export const monotonicSecs: Effect.Effect<MonotonicTimeSecs, never, ClockPort> = Effect.flatMap(
  ClockPort,
  (clock) => clock.monotonicSecs,
)

export const wallClockEpochMillis: Effect.Effect<EpochMillis, never, ClockPort> = Effect.flatMap(
  ClockPort,
  (clock) => clock.wallClockEpochMillis,
)

import type { Effect, Layer } from 'effect'
import type { ClockPort } from './clock'
import type { DeltaTimeSecs } from './quantities'
import type { StageId } from './identifiers'

export type FrameServices = ClockPort

export interface StageRegistration {
  readonly id: StageId
  readonly after?: ReadonlyArray<StageId>
  readonly run: (dt: DeltaTimeSecs) => Effect.Effect<void, never, FrameServices>
}

export interface GameModule<ROut, E, RIn, RRegister = never> {
  readonly layers: Layer.Layer<ROut, E, RIn>
  readonly frameStages: Effect.Effect<
    ReadonlyArray<StageRegistration>,
    never,
    RRegister
  >
}

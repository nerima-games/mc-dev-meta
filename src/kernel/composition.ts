import { Effect, Either, Layer } from 'effect'
import type { FrameServices, StageRegistration } from './frame'
import type { DeltaTimeSecs } from './quantities'
import {
  describeStagePlanWarnings,
  resolveStageOrder,
  type StageConstraint,
  type StageOrderError,
  type StageOrderPlan,
  type StagePhase,
} from './stage-order'
import { STANDARD_STAGE_SKELETON } from './stage-skeleton'

export type ModuleLayer = Layer.Layer<any, any, never>

export const EMPTY_MODULE_LAYER: ModuleLayer = Layer.empty as unknown as ModuleLayer

export type RegisteredModule = {
  readonly name: string
  readonly layers: ModuleLayer
  readonly frameStages: ReadonlyArray<StageRegistration>
}

export const registerModule = <RRegister>(module: {
  readonly name: string
  readonly layers: ModuleLayer
  readonly frameStages: Effect.Effect<ReadonlyArray<StageRegistration>, never, RRegister>
}): Effect.Effect<RegisteredModule, never, RRegister> =>
  Effect.map(module.frameStages, (frameStages) => ({
    name: module.name,
    layers: module.layers,
    frameStages,
  }))

export type ComposedGame = {
  readonly plan: StageOrderPlan
  readonly layer: ModuleLayer
  readonly runFrame: (dt: DeltaTimeSecs) => Effect.Effect<void, never, FrameServices>
  readonly runFrameWith: (
    services: Layer.Layer<FrameServices>,
  ) => (dt: DeltaTimeSecs) => Effect.Effect<void>
  readonly moduleNames: ReadonlyArray<string>
  readonly warnings: ReadonlyArray<string>
}

export type ComposeOptions = {
  readonly skeleton?: ReadonlyArray<StagePhase>
}

export const mergeModuleLayers = (modules: ReadonlyArray<RegisteredModule>): ModuleLayer => {
  let merged = EMPTY_MODULE_LAYER
  for (const module of modules) {
    merged = Layer.merge(merged, module.layers)
  }
  return merged
}

export const collectStages = (
  modules: ReadonlyArray<RegisteredModule>,
): ReadonlyArray<StageRegistration> => modules.flatMap((module) => [...module.frameStages])

const asConstraint = (registration: StageRegistration): StageConstraint =>
  registration.after === undefined
    ? { id: registration.id }
    : { id: registration.id, after: registration.after }

export const composeGame = (
  modules: ReadonlyArray<RegisteredModule>,
  options: ComposeOptions = {},
): Either.Either<ComposedGame, StageOrderError> => {
  const stages = collectStages(modules)
  const skeleton = options.skeleton ?? STANDARD_STAGE_SKELETON

  return Either.map(
    resolveStageOrder(stages.map(asConstraint), { skeleton }),
    (plan): ComposedGame => {
      const byId = new Map(stages.map((stage) => [stage.id, stage] as const))
      const ordered = plan.order.map((id) => byId.get(id)!)
      const runFrame = (dt: DeltaTimeSecs): Effect.Effect<void, never, FrameServices> =>
        Effect.forEach(ordered, (stage) => stage.run(dt), { discard: true })

      return {
        plan,
        layer: mergeModuleLayers(modules),
        moduleNames: modules.map((module) => module.name),
        runFrame,
        runFrameWith: (services) => (dt) => Effect.provide(runFrame(dt), services),
        warnings: describeStagePlanWarnings(plan),
      }
    },
  )
}

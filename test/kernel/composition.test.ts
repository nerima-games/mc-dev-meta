import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { FixedClockLayer } from '../../src/kernel/clock'
import {
  EMPTY_MODULE_LAYER,
  collectStages,
  composeGame,
  registerModule,
  type RegisteredModule,
} from '../../src/kernel/composition'
import { StageId } from '../../src/kernel/identifiers'
import { DeltaTimeSecs, EpochMillis, MonotonicTimeSecs } from '../../src/kernel/quantities'
import { stagePhase } from '../../src/kernel/stage-order'
import type { StageRegistration } from '../../src/kernel/frame'

const stage = (
  value: string,
  events: Array<string>,
  after?: ReadonlyArray<string>,
): StageRegistration => {
  const registration = {
    id: StageId(value),
    run: (_dt: DeltaTimeSecs) =>
      Effect.sync(() => {
        events.push(value)
      }),
  }
  return after === undefined
    ? registration
    : { ...registration, after: after.map((entry) => StageId(entry)) }
}

const moduleOf = (name: string, frameStages: ReadonlyArray<StageRegistration>): RegisteredModule => ({
  name,
  layers: EMPTY_MODULE_LAYER,
  frameStages,
})

const right = (result: ReturnType<typeof composeGame>) => {
  if (result._tag === 'Left') {
    throw new Error(`unexpected compose error: ${result.left._tag}`)
  }
  return result.right
}

describe('kernel composition', () => {
  it('registers a kernel module and flattens its stages', () => {
    const events: Array<string> = []
    const input = stage('input', events)
    const effect = registerModule({
      name: 'input-module',
      layers: EMPTY_MODULE_LAYER,
      frameStages: Effect.succeed([input]),
    })
    const registered = Effect.runSync(effect)

    expect(registered).toStrictEqual({
      name: 'input-module',
      layers: EMPTY_MODULE_LAYER,
      frameStages: [input],
    })
    expect(collectStages([registered])).toStrictEqual([input])
  })

  it('resolves modules, merges layers, and runs frames in skeleton order', () => {
    const events: Array<string> = []
    const skeleton = [
      stagePhase('input'),
      stagePhase('simulation', 'physics'),
      stagePhase('render', 'draw'),
    ]
    const game = right(
      composeGame(
        [
          moduleOf('renderer', [stage('render:draw', events)]),
          moduleOf('simulation', [stage('sim:physics', events)]),
          moduleOf('input', [stage('input', events)]),
        ],
        { skeleton },
      ),
    )

    expect(game.moduleNames).toStrictEqual(['renderer', 'simulation', 'input'])
    expect(game.plan.order.map(String)).toStrictEqual(['input', 'sim:physics', 'render:draw'])
    expect(game.warnings).toStrictEqual([])

    const clock = FixedClockLayer({
      monotonicSecs: MonotonicTimeSecs(10),
      wallClockEpochMillis: EpochMillis(1_725_000_000_000),
    })
    Effect.runSync(game.runFrameWith(clock)(DeltaTimeSecs(0.016)))
    expect(events).toStrictEqual(['input', 'sim:physics', 'render:draw'])
  })

  it('keeps legal unresolved constraints visible as composition warnings', () => {
    const events: Array<string> = []
    const game = right(
      composeGame(
        [
          moduleOf('simulation', [stage('sim:physics', events, ['missing'])]),
          moduleOf('mod', [stage('mod:custom', events)]),
        ],
        { skeleton: [stagePhase('simulation', 'physics')] },
      ),
    )

    expect(game.warnings).toStrictEqual([
      'stage "sim:physics" declares an unresolved predecessor "missing"',
      'stage "mod:custom" does not match any phase in the frame skeleton',
    ])
  })

  it('accepts an empty module set with the standard skeleton', () => {
    const game = right(composeGame([]))
    expect(game.plan).toStrictEqual({ order: [], dangling: [], unmatchedPhase: [] })
    expect(game.moduleNames).toStrictEqual([])
    expect(game.warnings).toStrictEqual([])
    Effect.runSync(game.runFrameWith(FixedClockLayer({
      monotonicSecs: MonotonicTimeSecs(0),
      wallClockEpochMillis: EpochMillis(0),
    }))(DeltaTimeSecs(0)))
  })

  it('rejects duplicate and cyclic frame stages', () => {
    const events: Array<string> = []
    const duplicate = composeGame([
      moduleOf('one', [stage('same', events)]),
      moduleOf('two', [stage('same', events)]),
    ])
    expect(duplicate._tag).toBe('Left')

    const cycle = composeGame([
      moduleOf('one', [stage('a', events, ['b'])]),
      moduleOf('two', [stage('b', events, ['a'])]),
    ])
    expect(cycle._tag).toBe('Left')
  })
})

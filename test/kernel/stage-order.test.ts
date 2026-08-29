import { Either } from 'effect'
import { describe, expect, it } from 'vitest'
import { StageId } from '../../src/kernel/identifiers'
import {
  describeStageOrderError,
  describeStagePlanWarnings,
  resolveStageOrder,
  stagePhase,
  type StageConstraint,
  type StageOrderError,
  type StageOrderPlan,
} from '../../src/kernel/stage-order'
import {
  SIMULATION_PHASES,
  SIMULATION_STAGES,
  STANDARD_STAGE_SKELETON,
} from '../../src/kernel/stage-skeleton'

const id = (value: string): StageId => StageId(value)

const constraint = (value: string, after?: ReadonlyArray<string>): StageConstraint =>
  after === undefined
    ? { id: id(value) }
    : { id: id(value), after: after.map((entry) => id(entry)) }

const right = (result: Either.Either<StageOrderPlan, StageOrderError>): StageOrderPlan => {
  if (result._tag === 'Left') {
    throw new Error(describeStageOrderError(result.left))
  }
  return result.right
}

const left = (result: Either.Either<StageOrderPlan, StageOrderError>): StageOrderError => {
  if (result._tag === 'Right') {
    throw new Error('expected stage order resolution to fail')
  }
  return result.left
}

describe('kernel stage ordering', () => {
  it('defines the standard phase backbone and canonical ids', () => {
    expect(STANDARD_STAGE_SKELETON).toHaveLength(14)
    expect(STANDARD_STAGE_SKELETON.map((phase) => phase.name)).toStrictEqual([
      'input',
      'network:inbound',
      'simulation:physics',
      'simulation:interactions',
      'simulation:entities',
      'simulation:fluids',
      'simulation:redstone',
      'simulation:time-weather',
      'network:outbound',
      'camera-mirror',
      'chunk-sync',
      'render',
      'post-fx',
      'hud-sync',
    ])
    expect(SIMULATION_PHASES).toHaveLength(6)
    expect(SIMULATION_STAGES.map(String)).toStrictEqual([
      'simulation:physics',
      'simulation:interactions',
      'simulation:entities',
      'simulation:fluids',
      'simulation:redstone',
      'simulation:time-weather',
    ])
    expect(stagePhase('custom')).toStrictEqual({ name: 'custom', members: ['custom'] })
    expect(stagePhase('custom', 'other')).toStrictEqual({ name: 'custom', members: ['other'] })
  })

  it('matches bare names, namespaced names, and namespace members', () => {
    const skeleton = [stagePhase('input'), stagePhase('redstone', 'redstone:')]
    const plan = right(
      resolveStageOrder(
        [
          constraint('redstone:power'),
          constraint('input'),
          constraint('redstoneish:power'),
          constraint('redstone:effects'),
        ],
        { skeleton },
      ),
    )

    expect(plan.order.map(String)).toStrictEqual([
      'input',
      'redstone:effects',
      'redstone:power',
      'redstoneish:power',
    ])
    expect(plan.unmatchedPhase.map(String)).toStrictEqual(['redstoneish:power'])
  })

  it('uses explicit constraints and deterministic lexical ties', () => {
    const skeleton = [stagePhase('first', 'a', 'b', 'c'), stagePhase('second')]
    const plan = right(
      resolveStageOrder(
        [
          constraint('free:z'),
          constraint('second'),
          constraint('first:b'),
          constraint('first:a'),
          constraint('first:c', ['first:a']),
        ],
        { skeleton },
      ),
    )

    expect(plan.order.map(String)).toStrictEqual([
      'first:a',
      'first:b',
      'first:c',
      'second',
      'free:z',
    ])
  })

  it('drops self and duplicate edges while reporting missing predecessors', () => {
    const plan = right(
      resolveStageOrder([
        constraint('a', ['a']),
        constraint('b', ['a', 'a', 'missing']),
      ]),
    )

    expect(plan.order.map(String)).toStrictEqual(['a', 'b'])
    expect(plan.dangling).toStrictEqual([{ stage: id('b'), missing: id('missing') }])
    expect(describeStagePlanWarnings(plan)).toStrictEqual([
      'stage "b" declares an unresolved predecessor "missing"',
    ])
  })

  it('rejects duplicate registrations and describes the failure', () => {
    const error = left(resolveStageOrder([constraint('same'), constraint('same')]))
    expect(error).toStrictEqual({ _tag: 'DuplicateStage', id: id('same') })
    expect(describeStageOrderError(error)).toBe('duplicate frame stage id: same')
  })

  it('returns a concrete cycle for cyclic constraints', () => {
    const error = left(
      resolveStageOrder([
        constraint('a', ['b']),
        constraint('b', ['a']),
      ]),
    )

    expect(error._tag).toBe('StageCycle')
    if (error._tag === 'StageCycle') {
      expect(error.cycle.map(String)).toStrictEqual(['a', 'b', 'a'])
      expect(describeStageOrderError(error)).toBe('frame stage cycle: a -> b -> a')
    }
  })

  it('does not report unmatched phases when no skeleton is supplied', () => {
    const plan = right(resolveStageOrder([constraint('z'), constraint('a')]))
    expect(plan.order.map(String)).toStrictEqual(['a', 'z'])
    expect(plan.unmatchedPhase).toStrictEqual([])
    expect(describeStagePlanWarnings(plan)).toStrictEqual([])
  })
})

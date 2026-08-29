import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { FixedClockLayer } from '../../src/kernel/clock'
import { composeGame, EMPTY_MODULE_LAYER, type RegisteredModule } from '../../src/kernel/composition'
import { StageId } from '../../src/kernel/identifiers'
import { DeltaTimeSecs, EpochMillis, MonotonicTimeSecs } from '../../src/kernel/quantities'
import type { StageRegistration } from '../../src/kernel/frame'

const makeModule = (name: string, events: Array<string>, stageName: string): RegisteredModule => {
  const stage: StageRegistration = {
    id: StageId(stageName),
    run: (_dt: DeltaTimeSecs) =>
      Effect.sync(() => {
        events.push(stageName)
      }),
  }
  return { name, layers: EMPTY_MODULE_LAYER, frameStages: [stage] }
}

describe('compose end-to-end', () => {
  it('runs a minimal input, simulation, and render pipeline', () => {
    const events: Array<string> = []
    const result = composeGame([
      makeModule('render', events, 'render:draw'),
      makeModule('simulation', events, 'sim:physics'),
      makeModule('input', events, 'input'),
    ], {
      skeleton: [
        { name: 'input', members: ['input'] },
        { name: 'simulation', members: ['physics'] },
        { name: 'render', members: ['draw'] },
      ],
    })

    expect(result._tag).toBe('Right')
    if (result._tag === 'Right') {
      Effect.runSync(result.right.runFrameWith(FixedClockLayer({
        monotonicSecs: MonotonicTimeSecs(0),
        wallClockEpochMillis: EpochMillis(0),
      }))(DeltaTimeSecs(1 / 60)))
      expect(events).toStrictEqual(['input', 'sim:physics', 'render:draw'])
    }
  })
})

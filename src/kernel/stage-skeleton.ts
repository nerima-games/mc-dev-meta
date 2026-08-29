import { StageId } from './identifiers'
import { stagePhase, type StagePhase } from './stage-order'

export const STAGE_PHASE_INPUT = stagePhase('input')
export const STAGE_PHASE_NETWORK_INBOUND = stagePhase('network:inbound', 'inbound')
export const STAGE_PHASE_SIM_PHYSICS = stagePhase('simulation:physics', 'physics')
export const STAGE_PHASE_SIM_INTERACTIONS = stagePhase(
  'simulation:interactions',
  'interactions',
)
export const STAGE_PHASE_SIM_ENTITIES = stagePhase('simulation:entities', 'entities')
export const STAGE_PHASE_SIM_FLUIDS = stagePhase('simulation:fluids', 'fluids')
export const STAGE_PHASE_SIM_REDSTONE = stagePhase(
  'simulation:redstone',
  'redstone',
  'redstone:',
)
export const STAGE_PHASE_SIM_TIME_WEATHER = stagePhase(
  'simulation:time-weather',
  'time-weather',
  'weather',
)
export const STAGE_PHASE_NETWORK_OUTBOUND = stagePhase('network:outbound', 'outbound')
export const STAGE_PHASE_CAMERA_MIRROR = stagePhase('camera-mirror')
export const STAGE_PHASE_CHUNK_SYNC = stagePhase('chunk-sync', 'chunk-sync', 'mesh-sync')
export const STAGE_PHASE_RENDER = stagePhase('render', 'render', 'draw')
export const STAGE_PHASE_POST_FX = stagePhase('post-fx')
export const STAGE_PHASE_HUD_SYNC = stagePhase('hud-sync', 'hud-sync', 'ui:')

export const STANDARD_STAGE_SKELETON: ReadonlyArray<StagePhase> = [
  STAGE_PHASE_INPUT,
  STAGE_PHASE_NETWORK_INBOUND,
  STAGE_PHASE_SIM_PHYSICS,
  STAGE_PHASE_SIM_INTERACTIONS,
  STAGE_PHASE_SIM_ENTITIES,
  STAGE_PHASE_SIM_FLUIDS,
  STAGE_PHASE_SIM_REDSTONE,
  STAGE_PHASE_SIM_TIME_WEATHER,
  STAGE_PHASE_NETWORK_OUTBOUND,
  STAGE_PHASE_CAMERA_MIRROR,
  STAGE_PHASE_CHUNK_SYNC,
  STAGE_PHASE_RENDER,
  STAGE_PHASE_POST_FX,
  STAGE_PHASE_HUD_SYNC,
]

export const SIMULATION_PHASES: ReadonlyArray<StagePhase> = [
  STAGE_PHASE_SIM_PHYSICS,
  STAGE_PHASE_SIM_INTERACTIONS,
  STAGE_PHASE_SIM_ENTITIES,
  STAGE_PHASE_SIM_FLUIDS,
  STAGE_PHASE_SIM_REDSTONE,
  STAGE_PHASE_SIM_TIME_WEATHER,
]

export const STAGE_INPUT = StageId(STAGE_PHASE_INPUT.name)
export const STAGE_NETWORK_INBOUND = StageId(STAGE_PHASE_NETWORK_INBOUND.name)
export const STAGE_SIM_PHYSICS = StageId(STAGE_PHASE_SIM_PHYSICS.name)
export const STAGE_SIM_INTERACTIONS = StageId(STAGE_PHASE_SIM_INTERACTIONS.name)
export const STAGE_SIM_ENTITIES = StageId(STAGE_PHASE_SIM_ENTITIES.name)
export const STAGE_SIM_FLUIDS = StageId(STAGE_PHASE_SIM_FLUIDS.name)
export const STAGE_SIM_REDSTONE = StageId(STAGE_PHASE_SIM_REDSTONE.name)
export const STAGE_SIM_TIME_WEATHER = StageId(STAGE_PHASE_SIM_TIME_WEATHER.name)
export const STAGE_NETWORK_OUTBOUND = StageId(STAGE_PHASE_NETWORK_OUTBOUND.name)
export const STAGE_CAMERA_MIRROR = StageId(STAGE_PHASE_CAMERA_MIRROR.name)
export const STAGE_CHUNK_SYNC = StageId(STAGE_PHASE_CHUNK_SYNC.name)
export const STAGE_RENDER = StageId(STAGE_PHASE_RENDER.name)
export const STAGE_POST_FX = StageId(STAGE_PHASE_POST_FX.name)
export const STAGE_HUD_SYNC = StageId(STAGE_PHASE_HUD_SYNC.name)

export const SIMULATION_STAGES: ReadonlyArray<StageId> = SIMULATION_PHASES.map((phase) =>
  StageId(phase.name),
)

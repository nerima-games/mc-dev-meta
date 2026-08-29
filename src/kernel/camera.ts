import type { Position } from './coordinates'
import type { MonotonicTimeSecs } from './quantities'

export type CameraPoseSnapshot = Readonly<{
  position: Position
  yawRadians: number
  pitchRadians: number
  capturedAtSecs: MonotonicTimeSecs
}>

export const snapshotAgeSecs = (
  snapshot: CameraPoseSnapshot,
  now: MonotonicTimeSecs,
): number => now - snapshot.capturedAtSecs

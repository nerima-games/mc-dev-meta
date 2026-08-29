import { Brand } from 'effect'

export const MAX_STACK_COUNT = 64

export type StackCount = number & Brand.Brand<'StackCount'>
export const StackCount = Brand.refined<StackCount>(
  (value) => Number.isInteger(value) && value >= 0 && value <= MAX_STACK_COUNT,
  (value) => Brand.error(`Expected a stack count in [0, ${MAX_STACK_COUNT}], got ${value}`),
)

export type DeltaTimeSecs = number & Brand.Brand<'DeltaTimeSecs'>
export const DeltaTimeSecs = Brand.refined<DeltaTimeSecs>(
  (value) => Number.isFinite(value) && value >= 0,
  (value) => Brand.error(`Expected a non-negative finite delta time, got ${value}`),
)

export type MonotonicTimeSecs = number & Brand.Brand<'MonotonicTimeSecs'>
export const MonotonicTimeSecs = Brand.refined<MonotonicTimeSecs>(
  (value) => Number.isFinite(value) && value >= 0,
  (value) => Brand.error(`Expected a non-negative finite monotonic time, got ${value}`),
)

export type EpochMillis = number & Brand.Brand<'EpochMillis'>
export const EpochMillis = Brand.refined<EpochMillis>(
  (value) => Number.isSafeInteger(value),
  (value) => Brand.error(`Expected a safe integer epoch time, got ${value}`),
)

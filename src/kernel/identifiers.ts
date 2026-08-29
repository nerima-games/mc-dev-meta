import { Brand } from 'effect'

export type WorldId = string & Brand.Brand<'WorldId'>
export const WorldId = Brand.refined<WorldId>(
  (value) => value.trim().length > 0,
  (value) => Brand.error(`Expected a non-empty world identifier, got ${JSON.stringify(value)}`),
)

export type StageId = string & Brand.Brand<'StageId'>
export const StageId = Brand.refined<StageId>(
  (value) => value.trim().length > 0,
  (value) => Brand.error(`Expected a non-empty stage identifier, got ${JSON.stringify(value)}`),
)

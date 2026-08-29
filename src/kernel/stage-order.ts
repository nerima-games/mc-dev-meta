import { Either } from 'effect'
import { assertUnreachable } from '../domain/exhaustive'
import type { StageId } from './identifiers'

export type StageConstraint = {
  readonly id: StageId
  readonly after?: ReadonlyArray<StageId>
}

export type DanglingEdge = {
  readonly stage: StageId
  readonly missing: StageId
}

export type StageOrderError =
  | { readonly _tag: 'DuplicateStage'; readonly id: StageId }
  | { readonly _tag: 'StageCycle'; readonly cycle: ReadonlyArray<StageId> }

export type StageOrderPlan = {
  readonly order: ReadonlyArray<StageId>
  readonly dangling: ReadonlyArray<DanglingEdge>
  readonly unmatchedPhase: ReadonlyArray<StageId>
}

export type StagePhase = {
  readonly name: string
  readonly members: ReadonlyArray<string>
}

export const stagePhase = (name: string, ...members: ReadonlyArray<string>): StagePhase => ({
  name,
  members: members.length === 0 ? [name] : members,
})

const namespaceOf = (id: StageId): string => {
  const separator = id.indexOf(':')
  return separator === -1 ? '' : id.slice(0, separator + 1)
}

const stageNameOf = (id: StageId): string => {
  const separator = id.lastIndexOf(':')
  return separator === -1 ? id : id.slice(separator + 1)
}

const phaseAdmits = (phase: StagePhase, id: StageId): boolean => {
  const namespace = namespaceOf(id)
  const name = stageNameOf(id)
  return phase.members.some((member) =>
    member.endsWith(':') ? namespace === member : name === member,
  )
}

const phaseOf = (
  skeleton: ReadonlyArray<StagePhase>,
  id: StageId,
): number | undefined => {
  const index = skeleton.findIndex((phase) => phaseAdmits(phase, id))
  return index === -1 ? undefined : index
}

const compareStages = (skeleton: ReadonlyArray<StagePhase>) => (left: StageId, right: StageId) => {
  const leftPhase = phaseOf(skeleton, left) ?? Number.MAX_SAFE_INTEGER
  const rightPhase = phaseOf(skeleton, right) ?? Number.MAX_SAFE_INTEGER
  return leftPhase - rightPhase || left.localeCompare(right)
}

const findCycle = (
  nodes: ReadonlyArray<StageId>,
  edges: ReadonlyMap<StageId, ReadonlySet<StageId>>,
): ReadonlyArray<StageId> => {
  const remaining = new Set(nodes)
  const done = new Set<StageId>()
  const onPath = new Set<StageId>()

  for (const start of nodes) {
    if (done.has(start)) {
      continue
    }

    const path: Array<StageId> = []
    const stack: Array<{ readonly node: StageId; readonly entering: boolean }> = [
      { node: start, entering: true },
    ]

    while (stack.length > 0) {
      const frame = stack.pop()!
      if (!frame.entering) {
        onPath.delete(frame.node)
        done.add(frame.node)
        path.pop()
        continue
      }

      if (done.has(frame.node)) {
        continue
      }
      if (onPath.has(frame.node)) {
        return [...path.slice(path.indexOf(frame.node)), frame.node]
      }

      onPath.add(frame.node)
      path.push(frame.node)
      stack.push({ node: frame.node, entering: false })
      for (const successor of edges.get(frame.node)!) {
        if (remaining.has(successor) && !done.has(successor)) {
          stack.push({ node: successor, entering: true })
        }
      }
    }
  }

  return nodes
}

export type ResolveStageOrderOptions = {
  readonly skeleton?: ReadonlyArray<StagePhase>
}

export const resolveStageOrder = (
  constraints: ReadonlyArray<StageConstraint>,
  options: ResolveStageOrderOptions = {},
): Either.Either<StageOrderPlan, StageOrderError> => {
  const skeleton = options.skeleton ?? []
  const registered = new Set<StageId>()
  for (const constraint of constraints) {
    if (registered.has(constraint.id)) {
      return Either.left({ _tag: 'DuplicateStage', id: constraint.id })
    }
    registered.add(constraint.id)
  }

  const successors = new Map<StageId, Set<StageId>>()
  const indegree = new Map<StageId, number>()
  for (const id of registered) {
    successors.set(id, new Set())
    indegree.set(id, 0)
  }

  const dangling: Array<DanglingEdge> = []
  const addEdge = (before: StageId, after: StageId): void => {
    if (before === after || successors.get(before)!.has(after)) {
      return
    }
    successors.get(before)!.add(after)
    indegree.set(after, indegree.get(after)! + 1)
  }

  for (const constraint of constraints) {
    for (const before of constraint.after ?? []) {
      if (registered.has(before)) {
        addEdge(before, constraint.id)
      } else {
        dangling.push({ stage: constraint.id, missing: before })
      }
    }
  }

  const byPhase = new Map<number, Array<StageId>>()
  for (const id of registered) {
    const index = phaseOf(skeleton, id)
    if (index === undefined) {
      continue
    }
    const bucket = byPhase.get(index)
    if (bucket === undefined) {
      byPhase.set(index, [id])
    } else {
      bucket.push(id)
    }
  }

  const populated = [...byPhase.keys()]
    .sort((left, right) => left - right)
    .map((index) => byPhase.get(index)!)
  for (let index = 1; index < populated.length; index += 1) {
    for (const before of populated[index - 1]!) {
      for (const after of populated[index]!) {
        addEdge(before, after)
      }
    }
  }

  const compare = compareStages(skeleton)
  const ready = [...registered].filter((id) => indegree.get(id)! === 0).sort(compare)
  const order: Array<StageId> = []
  while (ready.length > 0) {
    const next = ready.shift()!
    order.push(next)
    const unlocked: Array<StageId> = []
    for (const successor of successors.get(next)!) {
      const nextIndegree = indegree.get(successor)! - 1
      indegree.set(successor, nextIndegree)
      if (nextIndegree === 0) {
        unlocked.push(successor)
      }
    }
    if (unlocked.length > 0) {
      ready.push(...unlocked)
      ready.sort(compare)
    }
  }

  if (order.length !== registered.size) {
    const placed = new Set(order)
    const stuck = [...registered].filter((id) => !placed.has(id)).sort(compare)
    return Either.left({
      _tag: 'StageCycle',
      cycle: findCycle(stuck, successors),
    })
  }

  const unmatchedPhase =
    skeleton.length === 0
      ? []
      : [...registered].filter((id) => phaseOf(skeleton, id) === undefined).sort()

  return Either.right({ order, dangling, unmatchedPhase })
}

export const describeStagePlanWarnings = (plan: StageOrderPlan): ReadonlyArray<string> => [
  ...plan.dangling.map(
    ({ stage, missing }) => `stage "${stage}" declares an unresolved predecessor "${missing}"`,
  ),
  ...plan.unmatchedPhase.map(
    (id) => `stage "${id}" does not match any phase in the frame skeleton`,
  ),
]

export const describeStageOrderError = (error: StageOrderError): string => {
  switch (error._tag) {
    case 'DuplicateStage':
      return `duplicate frame stage id: ${error.id}`
    case 'StageCycle':
      return `frame stage cycle: ${error.cycle.join(' -> ')}`
    /* v8 ignore next 2 -- @preserve */
    default:
      return assertUnreachable(error)
  }
}

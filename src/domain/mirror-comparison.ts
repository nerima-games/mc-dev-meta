/** Pure comparison functions for the observed mirror surfaces. */

import { mirrorPath } from './mirror-path'
import { divergenceFor } from './mirror-registers'
import { REFINEMENT_SAMPLES, observationKind } from './mirror-model'
import type {
  CapabilityObservation,
  MirrorFinding,
  MirrorObservation,
  MirrorSpec,
  PropertyObservation,
  SampleVerdict,
  SourceObservation,
  TranscribedColumn,
  ValueObservation,
} from './mirror-model'
import type { TypeShape, TypeVariant } from './type-shape'

const verdictOf = (
  verdicts: ReadonlyArray<SampleVerdict>,
  sample: string,
): string => verdicts.find((entry) => entry.sample === sample)?.verdict ?? 'not probed'

const compareValues = (
  spec: MirrorSpec,
  mirror: ReadonlyArray<ValueObservation>,
  source: SourceObservation,
): ReadonlyArray<MirrorFinding> => {
  const bySourceName = new Map(source.values.map((value) => [value.name, value]))
  const probed = new Set(spec.capabilities.map((probe) => probe.mirrorExport))
  const findings: Array<MirrorFinding> = []

  for (const observed of mirror) {
    if (divergenceFor(spec, observed.name) !== undefined || probed.has(observed.name)) {
      continue
    }

    const counterpart = bySourceName.get(observed.name)
    if (counterpart === undefined) {
      // Not on the source's published surface at all. That is a finding rather
      // than a skip: the mirror header promises the file can be deleted and the
      // import repointed at the package, and a symbol the package does not
      // export makes that promise false.
      if (!source.published.has(observed.name)) {
        findings.push({ _tag: 'SymbolNotPublished', symbol: observed.name })
      }
      continue
    }

    if (observed._tag !== counterpart._tag) {
      findings.push({
        _tag: 'KindDiffers',
        symbol: observed.name,
        mirror: observationKind(observed),
        source: observationKind(counterpart),
      })
      continue
    }

    if (observed._tag === 'Scalar' && counterpart._tag === 'Scalar') {
      if (observed.rendered !== counterpart.rendered) {
        findings.push({
          _tag: 'ScalarDiffers',
          symbol: observed.name,
          mirror: observed.rendered,
          source: counterpart.rendered,
        })
      }
      continue
    }

    if (observed._tag === 'TagKey' && counterpart._tag === 'TagKey') {
      if (observed.key !== counterpart.key) {
        findings.push({
          _tag: 'TagKeyDiffers',
          symbol: observed.name,
          mirror: observed.key,
          source: counterpart.key,
        })
      }
      continue
    }

    if (observed._tag === 'Refinement' && counterpart._tag === 'Refinement') {
      const disagreements = REFINEMENT_SAMPLES.map((sample) => ({
        sample: sample.label,
        mirror: verdictOf(observed.verdicts, sample.label),
        source: verdictOf(counterpart.verdicts, sample.label),
      })).filter((entry) => entry.mirror !== entry.source)

      if (disagreements.length > 0) {
        findings.push({ _tag: 'RefinementDiffers', symbol: observed.name, disagreements })
      }
      continue
    }

    if (observed._tag === 'Opaque' && counterpart._tag === 'Opaque' && observed.kind !== counterpart.kind) {
      findings.push({
        _tag: 'KindDiffers',
        symbol: observed.name,
        mirror: observationKind(observed),
        source: observationKind(counterpart),
      })
    }
  }

  return findings
}

/**
 * Index a declaration's arms so the two sides can be matched up.
 *
 * A discriminated union is matched BY ITS `_tag`, never by position, because
 * the two sides write their arms in whatever order suited the author and a
 * reordering is not a change. An untagged arm falls back to its position, which
 * is all that is available; every union in this workspace is tagged, and a plain
 * object type is one untagged arm at position 0, so the fallback is exercised by
 * the common case rather than being untested contingency code.
 */
const armsByLabel = (shape: TypeShape): ReadonlyMap<string, TypeVariant> =>
  new Map(
    shape.variants.map((variant, index) => [variant.tag ?? `arm #${String(index)}`, variant]),
  )

/** `ChunkStoreApi`, or `BlockReading (_tag: "OutOfWorld")` for one arm of a union. */
const displayOf = (shape: TypeShape, name: string, label: string): string =>
  shape.variants.length === 1 && shape.variants[0]?.tag === undefined
    ? name
    : `${name} (_tag: ${JSON.stringify(label)})`

const compareTypes = (
  spec: MirrorSpec,
  mirror: ReadonlyArray<TypeShape>,
  source: SourceObservation,
): ReadonlyArray<MirrorFinding> => {
  const bySourceName = new Map(source.types.map((shape) => [shape.name, shape]))
  const renamed = new Map(spec.renamedTypes.map((entry) => [entry.mirror, entry.source]))
  const findings: Array<MirrorFinding> = []

  for (const shape of mirror) {
    if (divergenceFor(spec, shape.name) !== undefined) {
      continue
    }

    const lookedFor = renamed.get(shape.name) ?? shape.name
    const counterpart = bySourceName.get(lookedFor)
    if (counterpart === undefined) {
      if (!source.published.has(lookedFor)) {
        findings.push({ _tag: 'TypeNotPublished', type: shape.name, lookedFor })
      }
      continue
    }

    // Both sides unreadable as object types — a brand, an alias, `never`. There
    // is nothing here for a text comparison to say, and the value half says it
    // better. Both sides readable, or neither: anything else is a finding.
    if (shape.variants.length === 0 && counterpart.variants.length === 0) {
      continue
    }
    if (shape.variants.length === 0 || counterpart.variants.length === 0) {
      findings.push({
        _tag: 'ShapeNotComparable',
        type: shape.name,
        objectInMirror: shape.variants.length > 0,
      })
      continue
    }

    const mirrorArms = armsByLabel(shape)
    const sourceArms = armsByLabel(counterpart)

    for (const label of sourceArms.keys()) {
      if (!mirrorArms.has(label)) {
        findings.push({ _tag: 'VariantMissingFromMirror', type: shape.name, variant: label })
      }
    }
    for (const label of mirrorArms.keys()) {
      if (!sourceArms.has(label)) {
        findings.push({ _tag: 'VariantNotInSource', type: shape.name, variant: label })
      }
    }

    for (const [label, arm] of mirrorArms) {
      const counterpartArm = sourceArms.get(label)
      if (counterpartArm === undefined) {
        continue
      }
      const where = displayOf(shape, shape.name, label)
      const mirrorMembers = new Map(arm.members.map((member) => [member.name, member]))
      const sourceMembers = new Map(counterpartArm.members.map((member) => [member.name, member]))

      for (const member of counterpartArm.members) {
        // Unreachable with the committed DECLARED_DIVERGENCES today: both
        // real entries name a bare symbol or type ('BLOCK_DROP_REGISTRY',
        // 'BlockDropRegistryEntry'), not a `Type.member` subject. The
        // mechanism itself IS exercised — see the value- and type-level
        // divergence tests in test/mirror-contract.test.ts, which use these
        // real entries — this arm only needs a `Type.member` row to be added
        // to actually fire, which is a data change, not a code path this
        // suite can drive without inventing a divergence nobody declared.
        /* v8 ignore next 3 -- @preserve */
        if (divergenceFor(spec, `${shape.name}.${member.name}`) !== undefined) {
          continue
        }
        if (!mirrorMembers.has(member.name)) {
          findings.push({ _tag: 'MemberMissingFromMirror', type: where, member: member.name })
        }
      }

      for (const member of arm.members) {
        /* v8 ignore next 3 -- @preserve */
        if (divergenceFor(spec, `${shape.name}.${member.name}`) !== undefined) {
          continue
        }
        const counterpartMember = sourceMembers.get(member.name)
        if (counterpartMember === undefined) {
          findings.push({ _tag: 'MemberNotInSource', type: where, member: member.name })
          continue
        }
        if (counterpartMember.optional !== member.optional) {
          findings.push({
            _tag: 'OptionalityDiffers',
            type: where,
            member: member.name,
            mirrorOptional: member.optional,
          })
        }
      }
    }
  }

  return findings
}

const compareCapabilities = (
  spec: MirrorSpec,
  observed: ReadonlyArray<CapabilityObservation>,
): ReadonlyArray<MirrorFinding> => {
  const findings: Array<MirrorFinding> = []

  for (const capability of observed) {
    // Unreachable with the committed DECLARED_DIVERGENCES today: neither real
    // entry names a capability-shaped subject. The skip mechanism itself IS
    // exercised (see the value-level divergence test in
    // test/mirror-contract.test.ts) — this arm only needs a capability row
    // added to DECLARED_DIVERGENCES to fire, which is a data change.
    /* v8 ignore next 3 -- @preserve */
    if (divergenceFor(spec, capability.mirrorExport) !== undefined) {
      continue
    }
    const mirrorSet = new Set(capability.mirrorAccepts)
    const sourceSet = new Set(capability.ownerAccepts)
    const onlyInMirror = capability.mirrorAccepts.filter((id) => !sourceSet.has(id))
    const onlyInSource = capability.ownerAccepts.filter((id) => !mirrorSet.has(id))

    if (onlyInMirror.length > 0 || onlyInSource.length > 0) {
      findings.push({
        _tag: 'CapabilityDiffers',
        symbol: capability.mirrorExport,
        owner: capability.owner,
        capability: capability.capability,
        onlyInMirror,
        onlyInSource,
      })
    }
  }

  return findings
}

/**
 * Columns the mirror transcribes that `MIRROR_SPECS` never declared a probe for.
 *
 * `compareProperties` below checks that every DECLARED probe actually read
 * something. This checks the other direction, which is the one that cannot be
 * caught from inside the probe loop at all: a column with no row in
 * `MIRROR_SPECS` contributes no `PropertyObservation`, so it is absent from
 * every list the comparison walks and there is nothing to notice its absence.
 * The count 13/13 counts specs, not columns, so it stays 13/13.
 *
 * `DECLARED_DIVERGENCES` still exempts a column, exactly as it does for a
 * declared probe: a mirror that deliberately answers differently from its source
 * has said so, and saying so is the point of that list. What is NOT accepted is
 * silence.
 */
export const unprobedColumns = (
  spec: MirrorSpec,
  observed: ReadonlyArray<TranscribedColumn>,
): ReadonlyArray<MirrorFinding> => {
  const probed = new Set(spec.properties.map((probe) => probe.mirrorExport))

  return observed
    .filter((column) => !probed.has(column.mirrorExport))
    .filter((column) => divergenceFor(spec, column.mirrorExport) === undefined)
    .map((column) => ({
      _tag: 'PropertyColumnUnprobed' as const,
      symbol: column.mirrorExport,
      owner: column.owner,
      property: column.property,
    }))
}

/**
 * Diff one property column, id by id, over the owning table's whole range.
 *
 * The empty-readings guard is the per-probe restatement of `compareSurfaces`'s
 * empty-observation guard, and it is here for the same reason: a probe that read
 * no ids compares nothing, and `disagreements.length > 0` is false for a column
 * nobody looked at. That is the shape of failure kernel's audit §4.9.1(d)
 * describes — 検査していない成功 — and it must be a finding, not a pass.
 */
const compareProperties = (
  spec: MirrorSpec,
  observed: ReadonlyArray<PropertyObservation>,
): ReadonlyArray<MirrorFinding> => {
  const findings: Array<MirrorFinding> = []

  for (const property of observed) {
    // Unreachable with the committed DECLARED_DIVERGENCES today: neither real
    // entry names a property-shaped subject. The skip mechanism itself IS
    // exercised (see the value-level divergence test in
    // test/mirror-contract.test.ts) — this arm only needs a property row
    // added to DECLARED_DIVERGENCES to fire, which is a data change.
    /* v8 ignore next 3 -- @preserve */
    if (divergenceFor(spec, property.mirrorExport) !== undefined) {
      continue
    }

    if (property.readings.length === 0) {
      findings.push({
        _tag: 'PropertyProbeEmpty',
        symbol: property.mirrorExport,
        owner: property.owner,
        property: property.property,
      })
      continue
    }

    const disagreements = property.readings.filter((reading) => reading.mirror !== reading.owner)
    if (disagreements.length > 0) {
      findings.push({
        _tag: 'PropertyDiffers',
        symbol: property.mirrorExport,
        owner: property.owner,
        property: property.property,
        disagreements,
      })
    }
  }

  return findings
}

/**
 * Compare one mirror against its source.
 *
 * The empty-observation guard comes FIRST and is not negotiable. Every other
 * branch here compares two things; if there is nothing to compare, every
 * comparison trivially succeeds and the run reports agreement it never
 * established. A checker that certifies that nothing happened is the exact
 * failure api-extractor was rejected for (scripts/api-lock.ts), and it must not
 * be rebuilt here.
 */
export const compareSurfaces = (
  spec: MirrorSpec,
  mirror: MirrorObservation,
  source: SourceObservation,
): ReadonlyArray<MirrorFinding> => {
  if (mirror.values.length === 0 && mirror.types.length === 0) {
    return [
      {
        _tag: 'NothingObserved',
        detail:
          `${mirrorPath(spec)} was loaded but yielded no exported values and no object types. ` +
          'Either the file is empty, or the extractor is broken. Both are failures: with nothing ' +
          'to compare, every comparison below would pass.',
      },
    ]
  }

  if (source.published.size === 0) {
    return [
      {
        _tag: 'NothingObserved',
        detail:
          `${spec.source}/api-lock.md yielded no entries, so there is no published surface to ` +
          `compare ${mirrorPath(spec)} against. Run \`pnpm api:update\` in ${spec.source}, or fix ` +
          'domain/type-shape.ts.',
      },
    ]
  }

  return [
    ...compareValues(spec, mirror.values, source),
    ...compareTypes(spec, mirror.types, source),
    ...compareCapabilities(spec, mirror.capabilities),
    ...compareProperties(spec, mirror.properties),
    // Runs on the OBSERVED columns rather than the declared probes, so it is the
    // one check here that can fail a spec whose every declared probe passed.
    ...unprobedColumns(spec, mirror.probeableColumns),
  ]
}

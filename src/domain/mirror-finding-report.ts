import { assertUnreachable } from './exhaustive'
import { mirrorPath } from './mirror-path'
import type { MirrorFinding, MirrorSpec } from './mirror-model'

const list = (values: ReadonlyArray<string>): string => values.join(', ')

/**
 * A finding, as a sentence that names the repository, the symbol, what the
 * mirror says, and what the source says.
 */
export const describeMirrorFinding = (spec: MirrorSpec, finding: MirrorFinding): string => {
  const at = mirrorPath(spec)

  switch (finding._tag) {
    case 'ScalarDiffers':
      return (
        `${at}: ${finding.symbol} is ${finding.mirror}, but ${spec.source} publishes ` +
        `${finding.source}. The mirror is a transcription and this one is wrong.`
      )
    case 'TagKeyDiffers':
      return (
        `${at}: ${finding.symbol} is built from the tag key "${finding.mirror}", but ` +
        `${spec.source} uses "${finding.source}". Effect resolves tags by this string, so the ` +
        'two are different services at runtime while both repositories typecheck.'
      )
    case 'RefinementDiffers': {
      const rows = finding.disagreements.map(
        (entry) => `      ${entry.sample}: mirror ${entry.mirror}, ${spec.source} ${entry.source}`,
      )
      return [
        `${at}: the Brand refinement ${finding.symbol} disagrees with ${spec.source}'s on ` +
          `${String(finding.disagreements.length)} sample(s). Both brands carry the same key, so ` +
          'a value one repository accepts is a value the other believes it has already validated.',
        ...rows,
      ].join('\n')
    }
    case 'KindDiffers':
      return (
        `${at}: ${finding.symbol} is ${finding.mirror} here and ${finding.source} in ` +
        `${spec.source}.`
      )
    case 'SymbolNotPublished':
      return (
        `${at}: ${finding.symbol} is mirrored, but ${spec.source} does not export it from its ` +
        'barrel. When the source is published, deleting this mirror and repointing the import ' +
        'will not compile.'
      )
    case 'TypeNotPublished':
      return (
        `${at}: the type ${finding.type}${finding.lookedFor === finding.type ? '' : ` (looked up as ${finding.lookedFor})`}` +
        ` is not on ${spec.source}'s published surface. Either it was renamed, or this mirror ` +
        'stands in for something that will never be importable.'
      )
    case 'ShapeNotComparable':
      return (
        `${at}: ${finding.type} is an object type ` +
        `${finding.objectInMirror ? 'here but not in' : 'in'} ${spec.source}` +
        `${finding.objectInMirror ? '' : ' but not here'}. One of the two is an alias, a brand or ` +
        'a type this checker cannot read as a shape, so its members were never compared. That is ' +
        'reported rather than skipped: a type compared against nothing agrees with everything.'
      )
    case 'VariantMissingFromMirror':
      return (
        `${at}: the union ${finding.type} is missing the arm ${JSON.stringify(finding.variant)}, ` +
        `which ${spec.source} declares. A dropped arm is not a narrower type — an exhaustive ` +
        'switch here will never see the case, and the value it never handles arrives anyway.'
      )
    case 'VariantNotInSource':
      return (
        `${at}: the union ${finding.type} declares the arm ${JSON.stringify(finding.variant)}, ` +
        `which ${spec.source} does not. Nothing will ever produce it.`
      )
    case 'MemberMissingFromMirror':
      return (
        `${at}: ${finding.type} is missing the member "${finding.member}", which ${spec.source} ` +
        'declares. A narrower mirror of a service type is not "less of the vocabulary": a Layer ' +
        'built against it satisfies the full tag and the missing member reads undefined.'
      )
    case 'MemberNotInSource':
      return (
        `${at}: ${finding.type} declares "${finding.member}", which ${spec.source} does not. ` +
        'The mirror has invented a member that will disappear on the day the import is repointed.'
      )
    case 'OptionalityDiffers':
      return (
        `${at}: ${finding.type}.${finding.member} is ` +
        `${finding.mirrorOptional ? 'optional here and required' : 'required here and optional'} ` +
        `in ${spec.source}.`
      )
    case 'CapabilityDiffers': {
      const lines = [
        `${at}: ${finding.symbol} does not agree with ${finding.owner}'s ` +
          `"${finding.capability}" capability.`,
      ]
      if (finding.onlyInSource.length > 0) {
        lines.push(
          `      ${finding.owner} says TRUE for ids the mirror says FALSE for: ${list(finding.onlyInSource)}`,
        )
      }
      if (finding.onlyInMirror.length > 0) {
        lines.push(
          `      the mirror says TRUE for ids ${finding.owner} says FALSE for: ${list(finding.onlyInMirror)}`,
        )
      }
      lines.push(
        '      This is a hand-transcribed table. Adding a row to the source table should have ' +
          'been the whole change; here it is a second place that has to be edited and was not.',
      )
      return lines.join('\n')
    }
    case 'PropertyDiffers': {
      const rows = finding.disagreements.map(
        (entry) => `      ${entry.id}: mirror ${entry.mirror}, ${finding.owner} ${entry.owner}`,
      )
      return [
        `${at}: ${finding.symbol} does not agree with ${finding.owner}'s "${finding.property}" ` +
          `property on ${String(finding.disagreements.length)} id(s). Every id in ${finding.owner}'s ` +
          'range was read on both sides, so these are the only ones that differ:',
        ...rows,
        '      An id absent from a hand-written property table does not fail — it silently reads',
        `      as ${finding.owner}'s default. Check the DIRECTION of each row above before sizing`,
        '      this: for opacity the default is the DARK answer, and dark is the direction that',
        '      spawns mobs. Adding the row to the source table should have been the whole change.',
      ].join('\n')
    }
    case 'PropertyProbeEmpty':
      return (
        `${at}: the probe on ${finding.symbol} read ZERO ids of ${finding.owner}'s ` +
        `"${finding.property}" property, so it compared nothing and would have reported ` +
        'agreement. Either the owning table exposes an empty id range or the probe is broken. ' +
        'A column compared against nothing agrees with everything, which is the one result this ' +
        'checker must never produce.'
      )
    case 'PropertyColumnUnprobed':
      return (
        `${at}: it exports ${finding.symbol}, which transcribes ${finding.owner}'s ` +
        `"${finding.property}" column, and MIRROR_SPECS declares no property probe for it. ` +
        'Nothing compared that column on this run and nothing reported it as uncompared: the ' +
        'spec count is a count of SPECS, so a mirror missing a probe still prints as a pass. ' +
        `Add { mirrorExport: '${finding.symbol}', owner: '${finding.owner}', property: ` +
        `'${finding.property}' } to this spec's properties in domain/mirror-registry.ts, or, if ` +
        'the mirror answers differently on purpose, record it in DECLARED_DIVERGENCES.'
      )
    case 'NothingObserved':
      return `${at}: ${finding.detail}`
    /* v8 ignore next 2 -- @preserve */
    default:
      return assertUnreachable(finding)
  }
}

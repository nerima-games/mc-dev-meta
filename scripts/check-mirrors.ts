/**
 * `pnpm check:mirrors` — compare every hand-written cross-repository mirror
 * against the repository it mirrors.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * The argument for the check, the list of mirrors, and every comparison rule
 * live in `domain/mirror-contract.ts`, which is pure and unit-tested against
 * fixtures. This file is the shell: it decides which repositories are on disk,
 * imports the modules, runs the refinements, reads the lock files, and turns
 * the resulting plain data over to the domain.
 *
 * ---------------------------------------------------------------------------
 * Why the VALUE half imports real modules
 * ---------------------------------------------------------------------------
 *
 * Every other check in this repository is a pure function over text. This one
 * executes fifteen repositories' code, which deserves a justification.
 *
 * The defects being hunted are values: a block id, a brand's refinement
 * predicate, a `Context.Tag`'s key, a block's opacity class. All of them are
 * ordinary runtime objects, and the mirror and its source can simply be asked.
 * Reading them out of source text instead would mean re-implementing
 * `new Set([5, 8])`, `Brand.refined` and `Context.Tag(...)` in a parser, and
 * then maintaining a second, worse TypeScript. Importing is not the lazy option
 * here — it is the only one that cannot be wrong about what the code means.
 *
 * It also buys the property half for nothing extra. `opacity` and `supportRule`
 * are resolved through kernel's override-plus-default mechanism, so the value of
 * a column for an id is not READABLE anywhere: it is the row's override if the
 * row has one and `BLOCK_PROPERTY_DEFAULTS` otherwise. A text comparison would
 * have to reimplement that resolution. `propertyOfBlockId(id, 'opacity')` just
 * answers.
 *
 * The cost is that this half needs each clone's `node_modules` (the mirrors
 * import `effect`). An uninstalled workspace is a SKIP, for the same reason an
 * absent one is; see below.
 *
 * ---------------------------------------------------------------------------
 * Skip policy, and where its edge is
 * ---------------------------------------------------------------------------
 *
 * `repos/` is gitignored and empty in a fresh clone. `domain/workspace.ts`
 * settled the precedent: an absent or partial workspace is not a failure,
 * because otherwise mc-dev-meta could not be verified until fifteen other
 * repositories existed, which would make the tool that fetches them the last
 * thing to become trustworthy.
 *
 * So these are SKIPS, each with a printed reason:
 *   - the mirroring repository is not cloned;
 *   - the mirror file is gone (which is what SUCCESS looks like eventually:
 *     the source got published and the mirror was deleted — the message says to
 *     drop the row from MIRROR_SPECS);
 *   - the source repository is not cloned, or has no committed api-lock.md;
 *   - a module cannot be imported because a PACKAGE is not installed.
 *
 * And these are FAILURES, because they are not absence:
 *   - a present, installed module that throws on import;
 *   - a spec that names an export the mirror does not have (a stale spec must
 *     never be a silent no-op);
 *   - an api-lock.md or a mirror file that cannot be parsed;
 *   - and of course an actual disagreement.
 *
 * ---------------------------------------------------------------------------
 * Why this runs in `pnpm verify`
 * ---------------------------------------------------------------------------
 *
 * Because it costs nothing when there is nothing to check, and because a check
 * that is not in `verify` is a check that runs on the day someone remembers to
 * run it — which is never the day the drift is introduced. `pnpm api:check` is
 * in `verify` for exactly this reason and this is its cross-repository sibling.
 *
 * The counter-argument is real and worth stating: this is the only member of
 * `verify` whose result depends on files outside the repository, so `verify`
 * can now pass on one machine and fail on another with the same commit. That is
 * true, and it is the point. The composite state is pinned in `repos.json`; a
 * disagreement between two pinned revisions IS a property of this commit of
 * mc-dev-meta, and it is not a property of any other repository's commit,
 * because no other repository can see both.
 *
 * ---------------------------------------------------------------------------
 * Which checkout, and why the report has to say so
 * ---------------------------------------------------------------------------
 *
 * That last paragraph is the argument for reading `repos/` rather than the
 * sibling working copies — and it only holds while `repos/` really is the
 * pinned composite. For a while it was not, and could not be: `pnpm sync` and
 * `pnpm update:manifest` formed a closed loop and the pin could not advance
 * past whatever the other had last written (docs/manifest.md §5). This gate
 * then reported a mirror as missing an export that the working copy plainly
 * exported, which read as drift and cost a diagnosis.
 *
 * The loop is fixed elsewhere. What is fixed HERE is the half that would have
 * made it cheap: every run now prints the revisions it read and flags the ones
 * that are not the pin, and the failure block names the checkout. See
 * `MIRROR_SOURCE_NOTE` in domain/mirror-contract.ts for why the split with
 * mc-compose's `pnpm check:roster` is deliberate rather than accidental.
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  compareMirror,
  describeMirrorRun,
  describeProvenance,
  fingerprintFinding,
  mirrorPath,
  mirrorRunExitCode,
  MIRROR_SPECS,
  REFINEMENT_SAMPLES,
  type CapabilityObservation,
  type MirrorObservation,
  type MirrorOutcome,
  type MirrorSpec,
  type PropertyObservation,
  type SampleVerdict,
  type SourceObservation,
  type TranscribedColumn,
  type ValueObservation,
} from '../src/domain/mirror-contract'
import { loadManifest, provenanceOf } from './repos-provenance'
import { REPOS_DIRECTORY } from '../src/domain/workspace'
import {
  declaredTypes,
  describeShapeError,
  publishedNames,
  typesInApiLock,
  type TypeShape,
} from '../src/domain/type-shape'

const rootDir = process.cwd()

/** This is a CLI script; stdout/stderr ARE its output, not debug noise. */
const print = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const printError = (line: string): void => {
  process.stderr.write(`${line}\n`)
}

/** The committed API lock, at each repository's root. Same name in all sixteen. */
const API_LOCK_FILENAME = 'api-lock.md'

/** The barrel every repository publishes as its `.` entry point. */
const ENTRY_POINT = 'index.ts'

/**
 * The capability table lives in the owning repository's barrel under these two
 * names. Both are asserted to exist rather than assumed: if mc-kernel renames
 * `capabilityOfBlockId`, this check must fail loudly, not quietly stop probing.
 */
const CAPABILITY_LOOKUP = 'capabilityOfBlockId'
const BLOCK_TYPE_LOOKUP = 'blockTypeOfId'
const BLOCK_ID_MAX_NAME = 'BLOCK_ID_MAX'

/**
 * The PROPERTY table's generic accessor, the sibling of `CAPABILITY_LOOKUP`.
 *
 * A separate name because kernel splits the two at design time: booleans live in
 * `domain/block-capabilities.ts` behind `capabilityOfBlockId`, typed columns in
 * `domain/block-properties.ts` behind this one. Asserted to exist for the same
 * reason the capability lookup is — if kernel renames it, this check must fail
 * loudly rather than quietly stop probing a column it claims to compare.
 */
const PROPERTY_LOOKUP = 'propertyOfBlockId'

/** Raised for the conditions the header calls failures rather than absence. */
class MirrorCheckError extends Error {}

const repoDir = (name: string): string => path.join(rootDir, REPOS_DIRECTORY, name)

const readTextOrUndefined = async (file: string): Promise<string | undefined> =>
  readFile(file, 'utf8').catch(() => undefined)

const presentDirectories = async (): Promise<ReadonlySet<string>> => {
  const entries = await readdir(path.join(rootDir, REPOS_DIRECTORY), { withFileTypes: true }).catch(
    () => undefined,
  )
  return new Set(
    entries === undefined
      ? []
      : entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  )
}

// ---------------------------------------------------------------------------
// Importing
// ---------------------------------------------------------------------------

/**
 * True when an import failed because a PACKAGE is missing, rather than because
 * the code is broken.
 *
 * This is the line between "run `pnpm install`" (a skip) and "your mirror
 * throws" (a failure). Node reports both as errors; only the specifier tells
 * them apart, and a relative or absolute specifier that cannot be found means
 * the repository itself is inconsistent.
 */
const isUninstalledPackage = (cause: unknown): boolean => {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) {
    return false
  }
  const code = (cause as { readonly code?: unknown }).code
  if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
    return false
  }
  const message = cause instanceof Error ? cause.message : ''
  // A bare specifier — no leading `.` or `/` — is a package.
  return /Cannot find package|imported from/u.test(message) && !/Cannot find module '[./]/u.test(message)
}

type Loaded =
  | { readonly ok: true; readonly module: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly uninstalled: boolean; readonly detail: string }

const cache = new Map<string, Loaded>()

const loadModule = async (file: string): Promise<Loaded> => {
  const cached = cache.get(file)
  if (cached !== undefined) {
    return cached
  }
  const loaded: Loaded = await import(pathToFileURL(file).href)
    .then((module: Readonly<Record<string, unknown>>) => ({ ok: true as const, module }))
    .catch((cause: unknown) => ({
      ok: false as const,
      uninstalled: isUninstalledPackage(cause),
      detail: cause instanceof Error ? cause.message.split('\n')[0] ?? '' : String(cause),
    }))
  cache.set(file, loaded)
  return loaded
}

// ---------------------------------------------------------------------------
// Turning a live module into plain observations
// ---------------------------------------------------------------------------

const hasFunction = (value: object, name: string): boolean =>
  typeof (value as Readonly<Record<string, unknown>>)[name] === 'function'

const probeRefinement = (constructor: object): ReadonlyArray<SampleVerdict> =>
  REFINEMENT_SAMPLES.map((sample) => {
    try {
      const either = (constructor as { readonly either: (input: unknown) => { readonly _tag: string } }).either(
        sample.value,
      )
      return { sample: sample.label, verdict: either._tag === 'Right' ? 'accepted' : 'rejected' }
    } catch {
      // A refinement handed a value of the wrong primitive type throws from
      // inside its own predicate. That is a perfectly good third answer: two
      // agreeing refinements throw on exactly the same samples.
      return { sample: sample.label, verdict: 'threw' }
    }
  })

/**
 * Classify one exported value.
 *
 * Order matters. An Effect tag class and a `Brand.refined` constructor are both
 * functions; the tag is recognised first because it carries a `key` and the
 * brand does not.
 */
const observeValue = (name: string, value: unknown): ValueObservation => {
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return { _tag: 'Scalar', name, rendered: String(value) }
  }
  if (typeof value === 'string') {
    return { _tag: 'Scalar', name, rendered: JSON.stringify(value) }
  }
  if (typeof value === 'function') {
    const key = (value as { readonly key?: unknown }).key
    if (typeof key === 'string') {
      return { _tag: 'TagKey', name, key }
    }
    if (hasFunction(value, 'either') && hasFunction(value, 'option')) {
      return { _tag: 'Refinement', name, verdicts: probeRefinement(value) }
    }
    return { _tag: 'Opaque', name, kind: 'function' }
  }
  return { _tag: 'Opaque', name, kind: value === null ? 'null' : typeof value }
}

const observeValues = (module: Readonly<Record<string, unknown>>): ReadonlyArray<ValueObservation> =>
  Object.keys(module)
    .filter((name) => name !== 'default')
    .sort()
    .map((name) => observeValue(name, module[name]))

const typesIn = (label: string, text: string): ReadonlyArray<TypeShape> => {
  const parsed = declaredTypes(text)
  if (!parsed.ok) {
    throw new MirrorCheckError(`${label}: ${describeShapeError(parsed.error)}`)
  }
  return [...parsed.value.values()]
}

// ---------------------------------------------------------------------------
// The id domain both kinds of probe run over
// ---------------------------------------------------------------------------

/**
 * Every id the owning table can name, and how to render one.
 *
 * Shared by the capability and property halves so that the two cannot silently
 * come to disagree about what "the whole range" means. A property probe over a
 * SHORTER range than the capability probes would be the spot-check this file
 * exists to replace: a closed comparison over the owner's full range fails on an
 * untranscribed row, and a comparison that stops where the mirror's own table
 * stops agrees with a mirror that is missing rows.
 */
type BlockIdDomain = {
  readonly ids: ReadonlyArray<number>
  readonly render: (id: number) => string
}

const blockIdDomain = (ownerName: string, owner: Readonly<Record<string, unknown>>): BlockIdDomain => {
  const typeOfId = owner[BLOCK_TYPE_LOOKUP]
  const maximum = owner[BLOCK_ID_MAX_NAME]
  if (typeof typeOfId !== 'function' || typeof maximum !== 'number') {
    throw new MirrorCheckError(
      `${ownerName}: expected its barrel to export ${BLOCK_TYPE_LOOKUP} and ${BLOCK_ID_MAX_NAME}. ` +
        'Without them no probe can be run over its id range, and running nothing must not be ' +
        'reported as agreement.',
    )
  }

  return {
    ids: Array.from({ length: maximum + 1 }, (_unused, id) => id),
    render: (id: number): string => {
      const type = (typeOfId as (candidate: number) => unknown)(id)
      return typeof type === 'string' ? `${String(id)} (${type})` : `${String(id)} (unassigned)`
    },
  }
}

/**
 * The mirror's side of a probe, as a callable.
 *
 * A stale probe is a FAILURE and not a skip — the header's rule that "a spec
 * that names an export the mirror does not have must never be a silent no-op".
 */
const probedExport = (
  spec: MirrorSpec,
  mirror: Readonly<Record<string, unknown>>,
  mirrorExport: string,
  kind: string,
): ((id: number) => unknown) => {
  const value = mirror[mirrorExport]
  if (typeof value !== 'function') {
    throw new MirrorCheckError(
      `${mirrorPath(spec)}: MIRROR_SPECS declares a ${kind} probe on "${mirrorExport}", which the ` +
        'mirror does not export as a function. Either the mirror changed and the probe is stale, ' +
        'or the probe is a typo. It must not silently do nothing.',
    )
  }
  return value as (id: number) => unknown
}

// ---------------------------------------------------------------------------
// Capability probes
// ---------------------------------------------------------------------------

const readCapability = (
  spec: MirrorSpec,
  mirror: Readonly<Record<string, unknown>>,
  owner: Readonly<Record<string, unknown>>,
  probe: MirrorSpec['capabilities'][number],
): CapabilityObservation => {
  const mirrorPredicate = probedExport(spec, mirror, probe.mirrorExport, 'capability')

  const lookup = owner[CAPABILITY_LOOKUP]
  if (typeof lookup !== 'function') {
    throw new MirrorCheckError(
      `${probe.owner}: expected its barrel to export ${CAPABILITY_LOOKUP}. Without it a ` +
        'capability probe cannot be run, and running nothing must not be reported as agreement.',
    )
  }

  const { ids, render } = blockIdDomain(probe.owner, owner)

  return {
    mirrorExport: probe.mirrorExport,
    owner: probe.owner,
    capability: probe.capability,
    mirrorAccepts: ids.filter((id) => mirrorPredicate(id) === true).map(render),
    ownerAccepts: ids
      .filter(
        (id) => (lookup as (candidate: number, flag: string) => unknown)(id, probe.capability) === true,
      )
      .map(render),
  }
}

// ---------------------------------------------------------------------------
// Property probes
// ---------------------------------------------------------------------------

/**
 * Render one property value so that two of them can be compared as strings.
 *
 * `JSON.stringify` rather than `String`, because the columns are not all
 * scalars: `opacity` is a string enum, `lightEmission` is a number, and
 * `supportRule` is a struct whose arms differ by a `kind` field and a block
 * list. `String({kind:'none'})` is `[object Object]` for every rule there is,
 * which would report a mirror that had the wrong rule on every id as agreeing on
 * all of them — the failure mode this whole file is built against.
 *
 * Key order is not normalised and does not need to be: both sides of every
 * probed column are built from object literals whose key order is part of the
 * declaration being mirrored, so a reordering is itself a divergence worth
 * seeing. If that ever produces noise, the fix is a canonicalising renderer here
 * and not a looser comparison.
 */
const renderProperty = (value: unknown): string => JSON.stringify(value) ?? String(value)

const readProperty = (
  spec: MirrorSpec,
  mirror: Readonly<Record<string, unknown>>,
  owner: Readonly<Record<string, unknown>>,
  probe: MirrorSpec['properties'][number],
): PropertyObservation => {
  const mirrorLookup = probedExport(spec, mirror, probe.mirrorExport, 'property')

  const lookup = owner[PROPERTY_LOOKUP]
  if (typeof lookup !== 'function') {
    throw new MirrorCheckError(
      `${probe.owner}: expected its barrel to export ${PROPERTY_LOOKUP}. Without it a property ` +
        'probe cannot be run, and running nothing must not be reported as agreement.',
    )
  }

  const { ids, render } = blockIdDomain(probe.owner, owner)

  return {
    mirrorExport: probe.mirrorExport,
    owner: probe.owner,
    property: probe.property,
    // EVERY id, not only the ones that differ. The domain half does the diff;
    // handing it a pre-filtered list would move the decision into the shell and
    // make it untestable from fixtures, which is the split the whole check keeps.
    readings: ids.map((id) => ({
      id: render(id),
      mirror: renderProperty(mirrorLookup(id)),
      owner: renderProperty(
        (lookup as (candidate: number, name: string) => unknown)(id, probe.property),
      ),
    })),
  }
}

/**
 * kernel's list of property column names, e.g. `opacity`, `lightEmission`.
 *
 * Read from the owning barrel rather than restated here, because a list of
 * kernel's columns hard-coded in mc-dev-meta would be one more hand-maintained
 * transcription — the exact thing this file exists to catch going stale.
 */
const PROPERTY_NAMES = 'BLOCK_PROPERTY_NAMES'

/**
 * The `<column>OfBlockId` convention, which is what makes the coverage check
 * possible without mc-dev-meta knowing anything about any specific column.
 */
const accessorFor = (property: string): string => `${property}OfBlockId`

/**
 * Which property columns does this mirror actually transcribe?
 *
 * Answered by LOOKING AT THE MIRROR, which is the whole point: `MIRROR_SPECS` is
 * hand-maintained, so a check that asked it what to compare and then reported on
 * what it compared could only ever confirm its own list. A column is transcribed
 * if the mirror exports the accessor kernel names it by.
 *
 * The owning repository is resolved through the spec's declared probes where one
 * exists and falls back to `spec.source`, which is right for every mirror in the
 * workspace: the property tables live in the source barrel, and a probe naming a
 * THIRD repository as owner has, by existing, already been declared.
 */
const transcribedColumns = (
  mirror: Readonly<Record<string, unknown>>,
  owners: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): ReadonlyArray<TranscribedColumn> => {
  const columns: Array<TranscribedColumn> = []

  for (const [ownerName, owner] of owners) {
    const names = owner[PROPERTY_NAMES]
    if (!Array.isArray(names)) {
      continue
    }

    for (const property of names) {
      if (typeof property !== 'string') {
        continue
      }
      const accessor = accessorFor(property)
      // Both sides must have it. The mirror exporting it is what makes the
      // column transcribed; the owner exporting it is what makes it PROBEABLE,
      // and a column kernel keeps behind `propertyOfBlockId` alone cannot be
      // compared symbol-for-symbol even if a mirror invented an accessor for it.
      if (hasFunction(mirror, accessor) && hasFunction(owner, accessor)) {
        columns.push({ mirrorExport: accessor, property, owner: ownerName })
      }
    }
  }

  return columns
}

// ---------------------------------------------------------------------------
// One mirror
// ---------------------------------------------------------------------------

const skip = (spec: MirrorSpec, reason: string): MirrorOutcome => ({ _tag: 'Skipped', spec, reason })

const checkOne = async (spec: MirrorSpec, present: ReadonlySet<string>): Promise<MirrorOutcome> => {
  if (!present.has(spec.repository)) {
    return skip(spec, `${spec.repository} is not cloned`)
  }
  if (!present.has(spec.source)) {
    return skip(spec, `its source ${spec.source} is not cloned`)
  }
  for (const probe of spec.capabilities) {
    if (!present.has(probe.owner)) {
      return skip(spec, `${probe.owner}, which owns the "${probe.capability}" table, is not cloned`)
    }
  }
  for (const probe of spec.properties) {
    if (!present.has(probe.owner)) {
      return skip(spec, `${probe.owner}, which owns the "${probe.property}" property, is not cloned`)
    }
  }

  const mirrorFile = path.join(repoDir(spec.repository), spec.file)
  const mirrorText = await readTextOrUndefined(mirrorFile)
  if (mirrorText === undefined) {
    return skip(
      spec,
      `${spec.file} no longer exists. If ${spec.source} was published and the mirror deleted, ` +
        'delete its row from MIRROR_SPECS in domain/mirror-contract.ts too.',
    )
  }

  const lockText = await readTextOrUndefined(path.join(repoDir(spec.source), API_LOCK_FILENAME))
  if (lockText === undefined) {
    return skip(spec, `${spec.source} has no committed ${API_LOCK_FILENAME}`)
  }

  const mirrorModule = await loadModule(mirrorFile)
  if (!mirrorModule.ok) {
    if (mirrorModule.uninstalled) {
      return skip(spec, `${spec.repository} is cloned but not installed (${mirrorModule.detail})`)
    }
    throw new MirrorCheckError(`${mirrorPath(spec)} could not be imported: ${mirrorModule.detail}`)
  }

  const sourceModule = await loadModule(path.join(repoDir(spec.source), ENTRY_POINT))
  if (!sourceModule.ok) {
    if (sourceModule.uninstalled) {
      return skip(spec, `${spec.source} is cloned but not installed (${sourceModule.detail})`)
    }
    throw new MirrorCheckError(
      `${spec.source}/${ENTRY_POINT} could not be imported: ${sourceModule.detail}`,
    )
  }

  // Both probe kinds read the same owning barrels, so they are loaded once for
  // the union of the two lists. `loadModule` caches anyway; doing it in one pass
  // is what keeps the skip-on-uninstalled decision in a single place.
  // `spec.source` is in this set even when no probe names it, and that is the
  // whole of the coverage check's reach. A mirror whose `properties` array is
  // EMPTY is exactly the case §4.9.1(d) describes, and resolving owners from the
  // declared probes alone would load nothing for it, observe no columns, and
  // clear it — the check would be unable to see the only mirrors it exists for.
  const ownerNames = [
    ...new Set([
      spec.source,
      ...spec.capabilities.map((probe) => probe.owner),
      ...spec.properties.map((probe) => probe.owner),
    ]),
  ]
  const owners = new Map(
    await Promise.all(
      ownerNames.map(
        async (name) =>
          [name, await loadModule(path.join(repoDir(name), ENTRY_POINT))] as const,
      ),
    ),
  )

  for (const name of ownerNames) {
    const owner = owners.get(name)
    if (owner === undefined || owner.ok) {
      continue
    }
    if (owner.uninstalled) {
      return skip(spec, `${name} is cloned but not installed (${owner.detail})`)
    }
    throw new MirrorCheckError(`${name}/${ENTRY_POINT} could not be imported: ${owner.detail}`)
  }

  /** Every owner above is loaded and `ok` by here; this narrows it for the probes. */
  const ownerModule = (name: string): Readonly<Record<string, unknown>> => {
    const owner = owners.get(name)
    if (owner === undefined || !owner.ok) {
      throw new MirrorCheckError(`${name}/${ENTRY_POINT} was not loaded.`)
    }
    return owner.module
  }

  const capabilities: Array<CapabilityObservation> = spec.capabilities.map((probe) =>
    readCapability(spec, mirrorModule.module, ownerModule(probe.owner), probe),
  )

  const properties: Array<PropertyObservation> = spec.properties.map((probe) =>
    readProperty(spec, mirrorModule.module, ownerModule(probe.owner), probe),
  )

  const lockTypes = typesInApiLock(lockText)
  if (!lockTypes.ok) {
    throw new MirrorCheckError(
      `${spec.source}/${API_LOCK_FILENAME}: ${describeShapeError(lockTypes.error)}`,
    )
  }

  const observation: MirrorObservation = {
    values: observeValues(mirrorModule.module),
    types: typesIn(mirrorPath(spec), mirrorText).filter((shape) => shape.exported),
    capabilities,
    properties,
    probeableColumns: transcribedColumns(
      mirrorModule.module,
      new Map(ownerNames.map((name) => [name, ownerModule(name)])),
    ),
  }

  const source: SourceObservation = {
    values: observeValues(sourceModule.module),
    types: [...lockTypes.value.values()],
    published: publishedNames(lockText),
  }

  return compareMirror(spec, observation, source)
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export const main = async (): Promise<number> => {
  const present = await presentDirectories()

  // Printed BEFORE the comparison, not after, so that a run which then throws
  // — a mirror that cannot be imported, say — has still said what it was
  // looking at. The report below repeats the source note for the same reason.
  const provenance = await provenanceOf(
    rootDir,
    [...new Set(MIRROR_SPECS.flatMap((spec) => [spec.repository, spec.source]))]
      .filter((name) => present.has(name))
      .sort(),
    await loadManifest(rootDir, 'check:mirrors'),
  )
  for (const line of describeProvenance(provenance)) {
    print(line)
  }
  print('')

  // Sequential rather than `Promise.all`: the imports share a module cache and
  // the report has to come out in MIRROR_SPECS order for a diff of two runs to
  // be readable. Fifteen dynamic imports are not the slow part of `verify`.
  const outcomes = await MIRROR_SPECS.reduce<Promise<ReadonlyArray<MirrorOutcome>>>(
    async (accumulated, spec) => {
      const previous = await accumulated
      return [...previous, await checkOne(spec, present)]
    },
    Promise.resolve([]),
  )

  // `KNOWN_FINDINGS` says a fingerprint is "produced by running the check, not
  // written by hand, so an entry cannot be widened by accident" — and until this
  // block existed there was no way to run the check and GET one. Recording a
  // known finding meant reassembling the JSON by eye, which is exactly the
  // accidental widening the opacity of the field is meant to prevent, and a
  // property finding carrying twenty-five rows makes that hopeless rather than
  // merely tedious.
  //
  // Off by default and printing only. It cannot change a verdict: the exit code
  // is computed below from the same outcomes either way.
  if (process.env['MIRROR_FINGERPRINTS'] === '1') {
    for (const outcome of outcomes) {
      if (outcome._tag !== 'Compared') {
        continue
      }
      for (const finding of outcome.findings) {
        print(`FINGERPRINT ${fingerprintFinding(outcome.spec, finding)}`)
      }
    }
  }

  const exitCode = mirrorRunExitCode(outcomes)
  const report = describeMirrorRun(outcomes)
  for (const line of report) {
    if (exitCode === 0) {
      print(line)
    } else {
      printError(line)
    }
  }

  return exitCode
}

const isDirectRun = (): boolean => {
  const entry = process.argv[1]
  return entry !== undefined && path.basename(entry) === 'check-mirrors.ts'
}

if (isDirectRun()) {
  const code = await main().catch((cause: unknown) => {
    printError(`check:mirrors: ${cause instanceof Error ? cause.message : String(cause)}`)
    return 1
  })
  process.exit(code)
}

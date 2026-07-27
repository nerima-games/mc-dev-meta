/**
 * Cross-repository repoint verification: the decision half. PURE — no
 * filesystem, no child process, no dependencies.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * What this adds to `pnpm check:mirrors`, and why that gate is not enough
 * ---------------------------------------------------------------------------
 *
 * `domain/mirror-contract.ts` compares a mirror against its source and is the
 * stronger gate of the two for the defects it hunts: it RUNS both modules, so a
 * block id, a brand's refinement and a `Context.Tag`'s key are compared as
 * values rather than as text. Nothing here replaces any of that.
 *
 * What it does not do is run a compiler. It answers "do these two declarations
 * have the same shape?", and every mirror header in the organisation makes a
 * strictly larger claim than that:
 *
 *     delete this file and repoint the import at the package.
 *
 * Those are different sentences. Shape equality is NECESSARY for the repoint to
 * work and it is not SUFFICIENT, because a repoint also has to survive module
 * resolution, the `exports` map, the `types` field, the barrel's re-export
 * shape, and — the one that actually bit — TYPE IDENTITY AT EVERY USE SITE
 * rather than at the declaration. `domain/type-shape.ts` deliberately compares
 * member names and optionality and NOT member types, for the good reason that
 * the mirrors diverge in their types on purpose. A divergence that is harmless
 * where the type is DECLARED can still be fatal where it is CONSUMED, and no
 * amount of shape comparison can see that. A compiler can.
 *
 * ---------------------------------------------------------------------------
 * The defect this found on its first run
 * ---------------------------------------------------------------------------
 *
 * `mx-gameplay`, `mx-ui` and `mx-redstone` each carry
 * `domain/frame-contract.ts`, mirroring mc-kernel. Each declares
 *
 *     export type FrameServices = never
 *
 * where kernel declares `FrameServices = ClockPort`. Each mirror's header calls
 * this a deliberate divergence and argues it is forward-compatible, because an
 * `Effect<void, never, never>` is assignable wherever `Effect<void, never,
 * ClockPort>` is wanted.
 *
 * That argument is CORRECT, and it is correct about stage AUTHORS. All three
 * repositories' shipped source repoints and compiles with zero errors. It says
 * nothing about stage RUNNERS — the code that takes a `StageRegistration` and
 * executes `run(dt)`. For those the assignability runs the other way: the
 * effect now demands a `ClockPort` that the caller never provides. All three
 * repositories have such code, in their own test harnesses and preview apps,
 * and all three fail to compile.
 *
 * mc-kernel's `docs/freeze-checklist.md` predicted exactly this in prose —
 * 「この別名を広げるのは stage の *提供者* にとって破壊的変更である」 — and
 * `pnpm check:mirrors` reported all three mirrors as agreeing, because they do
 * agree, on shape. Nobody had run the compiler, so nobody knew the size of it.
 *
 * ---------------------------------------------------------------------------
 * Why a baseline compile, and not just the repointed one
 * ---------------------------------------------------------------------------
 *
 * A downstream that does not typecheck BEFORE the repoint would report every
 * pre-existing error as though the repoint caused it, and the first person to
 * read that report would spend an afternoon on somebody else's unrelated bug.
 * So every project is compiled twice — once untouched, once repointed — and
 * only diagnostics ABSENT from the baseline are attributed to the repoint. This
 * is the same reasoning `describeProvenance` applies to revisions: a finding
 * measured against an unstated background is a finding nobody can act on.
 *
 * ---------------------------------------------------------------------------
 * What a green run does NOT prove
 * ---------------------------------------------------------------------------
 *
 * A WORKSPACE REPOINT IS NOT A PUBLISHED-PACKAGE INSTALL, and the difference is
 * not academic. This gate resolves `@nerima-games/mc-kernel` to a directory,
 * so it exercises the `exports` map and the `types` field of that directory's
 * `package.json` — but it never builds a tarball, so `files` is never consulted
 * and a package that would ship without half its `domain/` still passes here.
 * mc-render has already come within one review of publishing exactly that.
 *
 * It also proves nothing about behaviour. It is a typecheck; two modules can
 * typecheck against each other and disagree about what a function means.
 */

import { type MirrorSpec, MIRROR_SPECS } from './mirror-contract'

// ---------------------------------------------------------------------------
// The registry: which mirror gets repointed at which package
// ---------------------------------------------------------------------------

/**
 * One repoint this gate performs.
 *
 * Deliberately a SEPARATE list from `MIRROR_SPECS` rather than a flag on it,
 * because the two answer different questions and not every mirror is a
 * repoint candidate. A mirror whose source is not yet importable as a package
 * — no `exports` entry, no installable directory — belongs in `MIRROR_SPECS`
 * and does not belong here, and merging the lists would force this gate to
 * carry an "except this one" column that nobody would maintain.
 *
 * Every entry is CHECKED AGAINST `MIRROR_SPECS` at run time by
 * `unmatchedRepointSpecs` below: a repoint of a file the mirror gate does not
 * know about is a transcription error in one of the two lists.
 */
export type RepointSpec = {
  /** The repository holding the mirror. Must match a `MirrorSpec.repository`. */
  readonly repository: string
  /** The mirror file, relative to that repository's root. Must match a `MirrorSpec.file`. */
  readonly file: string
  /** The package specifier the imports are rewritten to. */
  readonly packageName: string
  /**
   * The directory under `repos/` that provides `packageName`.
   *
   * Named separately from `packageName` because the gate has to LINK the one to
   * the other, and deriving a directory from a scoped package name by string
   * surgery is the kind of guess that works for fifteen repositories and then
   * silently picks the wrong one for the sixteenth.
   */
  readonly source: string
}

/**
 * The repoints this gate performs.
 *
 * `frame-contract.ts` was the first cut, and that was a scope decision rather
 * than an oversight: it is the mirror whose deletion the freeze checklist is
 * actually waiting on, it is carried by three repositories rather than one —
 * which is what turned a finding into a systemic one — and its source is the
 * repository being frozen. The `kernel-vocabulary.ts` mirrors are still the
 * obvious next five rows; they are left out so that the gate's own failure
 * modes are understood on a small set first.
 *
 * `inventory-port.ts` is the SECOND source repository this gate has ever
 * pointed at, and it is here for a reason `frame-contract` does not have. It is
 * the widest mirror in the workspace — the whole of `InventoryServiceApi` plus
 * mc-sim's crafting vocabulary underneath it — and the part of it that is
 * hardest to check is the part `check:mirrors` deliberately does not look at:
 * MEMBER TYPES. `domain/type-shape.ts` compares names and optionality only,
 * because the mirrors diverge in their types on purpose, so `ItemStack.count`
 * being `number` here and `StackCount` in mc-sim would pass that gate and fail
 * a compiler. mx-gameplay declines the divergence and transcribes the brand;
 * this row is what makes the declining checkable.
 */
export const REPOINT_SPECS: ReadonlyArray<RepointSpec> = [
  {
    repository: 'mx-gameplay',
    file: 'domain/frame-contract.ts',
    packageName: '@nerima-games/mc-kernel',
    source: 'mc-kernel',
  },
  {
    repository: 'mx-gameplay',
    file: 'domain/inventory-port.ts',
    packageName: '@nerima-games/mc-sim',
    source: 'mc-sim',
  },
  {
    repository: 'mx-ui',
    file: 'domain/frame-contract.ts',
    packageName: '@nerima-games/mc-kernel',
    source: 'mc-kernel',
  },
  {
    repository: 'mx-redstone',
    file: 'domain/frame-contract.ts',
    packageName: '@nerima-games/mc-kernel',
    source: 'mc-kernel',
  },
]

/** Where in the workspace a repoint's mirror lives, for messages. */
export const repointPath = (spec: RepointSpec): string => `${spec.repository}/${spec.file}`

/**
 * Repoint specs that name a file `MIRROR_SPECS` does not carry.
 *
 * A repoint is a claim that a specific mirror can be deleted. If the mirror
 * gate has never heard of that file, one of the two lists is wrong, and the
 * failure mode of NOT checking is the worse one: this gate would keep
 * cheerfully repointing a file that `check:mirrors` no longer compares, and two
 * registries would drift apart with nothing watching either.
 */
export const unmatchedRepointSpecs = (
  specs: ReadonlyArray<RepointSpec> = REPOINT_SPECS,
  mirrors: ReadonlyArray<MirrorSpec> = MIRROR_SPECS,
): ReadonlyArray<RepointSpec> =>
  specs.filter(
    (spec) =>
      !mirrors.some(
        (mirror) => mirror.repository === spec.repository && mirror.file === spec.file,
      ),
  )

// ---------------------------------------------------------------------------
// Which projects get compiled
// ---------------------------------------------------------------------------

/**
 * The tsconfig projects a repository's own `pnpm typecheck` compiles.
 *
 * Read out of the `typecheck` script rather than hard-coded here, and rather
 * than globbing `tsconfig.*.json`. Both alternatives were tried on paper and
 * both are worse:
 *
 *   - A hard-coded list in this file is a transcription of sixteen other
 *     repositories' build layouts, which is precisely the class of thing this
 *     whole repository exists to stop people writing by hand.
 *   - A glob compiles whatever happens to be on disk, including
 *     `tsconfig.base.json` (not a project — it has no `include`) and the
 *     editor-default `tsconfig.json`, and it would silently start or stop
 *     covering a project when somebody added a file.
 *
 * The script is the repository's OWN definition of "this typechecks", so a
 * repository that changes what it compiles moves this gate with it and nobody
 * has to remember. Extraction is a regex over `-p <path>`, which is what all
 * sixteen scripts are written with.
 *
 * Returns them in script order and de-duplicated. An EMPTY result is a failure
 * at the call site, never a pass: a repository whose typecheck script this
 * cannot read must not be reported as having compiled cleanly.
 */
export const typecheckProjects = (packageJsonText: string): ReadonlyArray<string> => {
  const parsed: unknown = JSON.parse(packageJsonText)
  const scripts =
    typeof parsed === 'object' && parsed !== null && 'scripts' in parsed
      ? (parsed as { readonly scripts?: unknown }).scripts
      : undefined
  const script =
    typeof scripts === 'object' && scripts !== null && 'typecheck' in scripts
      ? (scripts as { readonly typecheck?: unknown }).typecheck
      : undefined
  if (typeof script !== 'string') {
    return []
  }

  const found: Array<string> = []
  const pattern = /-p\s+(\S+)/gu
  let match = pattern.exec(script)
  while (match !== null) {
    const project = match[1]
    if (project !== undefined && !found.includes(project)) {
      found.push(project)
    }
    match = pattern.exec(script)
  }
  return found
}

// ---------------------------------------------------------------------------
// Rewriting the imports
// ---------------------------------------------------------------------------

/**
 * The module basename a mirror is imported by, e.g. `frame-contract`.
 *
 * Derived from the spec's `file` so that the two can never disagree.
 */
export const mirrorModuleName = (spec: RepointSpec): string => {
  const base = spec.file.slice(spec.file.lastIndexOf('/') + 1)
  return base.endsWith('.ts') ? base.slice(0, -3) : base
}

export type RewriteResult = {
  readonly text: string
  /** How many specifiers were replaced. Zero is a failure at the call site. */
  readonly rewrites: number
}

/**
 * Repoint every relative import of one mirror module at a package.
 *
 * Matches a RELATIVE specifier whose final segment is the mirror's module name,
 * in `from '...'` and `import('...')` position. The final-segment anchor is
 * what stops `'./frame-contract-extra'` from being rewritten, and requiring a
 * leading `./` or `../` is what stops a package specifier that happens to end
 * in the same word.
 *
 * KNOWN LIMIT, and it is a deliberate trade. This is a regex over text, not a
 * parse, for the same reason `scripts/check-dependency-whitelist.ts` is: the
 * gate must have no dependencies of its own. A DOC COMMENT containing the exact
 * bytes `from './frame-contract'` would be rewritten too. That is harmless —
 * a comment does not compile — and the alternative is carrying a TypeScript
 * parser to protect prose. Comments referring to the mirror in this
 * organisation are written with backticks around a bare path and do not match.
 */
export const rewriteMirrorImports = (
  text: string,
  moduleName: string,
  packageName: string,
): RewriteResult => {
  // Escaped because a module name is data, and a `.` in one would otherwise be
  // a wildcard that made the anchor above meaningless.
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const pattern = new RegExp(
    `(from\\s*|import\\s*\\(\\s*)(['"])((?:\\.\\.?/)+(?:[^'"\\n]*/)?${escaped})\\2`,
    'gu',
  )
  let rewrites = 0
  const rewritten = text.replace(pattern, (_match, lead: string, quote: string) => {
    rewrites += 1
    return `${lead}${quote}${packageName}${quote}`
  })
  return { text: rewritten, rewrites }
}

/**
 * Add the workspace dependency the repoint needs, in the SCRATCH COPY ONLY.
 *
 * This is the constraint the mirrors exist to satisfy, so it is worth stating
 * where the code that breaks it would go: each of the sixteen repositories also
 * builds standalone in its own CI, where `workspace:*` does not resolve. The
 * dependency therefore may NEVER be committed to a real `package.json` before
 * the source is published. It is added to a throwaway copy, which is the entire
 * reason this gate works on a copy rather than in place.
 *
 * Returns the text unchanged if the dependency is already declared, so that the
 * day mc-kernel IS published and the downstreams DO depend on it, this gate
 * keeps working rather than writing a duplicate key.
 */
export const withWorkspaceDependency = (
  packageJsonText: string,
  packageName: string,
): string => {
  const parsed: unknown = JSON.parse(packageJsonText)
  if (typeof parsed !== 'object' || parsed === null) {
    return packageJsonText
  }
  const record = parsed as Record<string, unknown>
  const existing = record['dependencies']
  const dependencies =
    typeof existing === 'object' && existing !== null
      ? (existing as Record<string, unknown>)
      : {}
  if (packageName in dependencies) {
    return packageJsonText
  }
  return `${JSON.stringify(
    { ...record, dependencies: { ...dependencies, [packageName]: 'workspace:*' } },
    undefined,
    2,
  )}\n`
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/** One `tsc --pretty false` diagnostic, reduced to plain comparable data. */
export type Diagnostic = {
  /** Path as tsc printed it, relative to the project. */
  readonly file: string
  readonly line: number
  readonly column: number
  /** e.g. `TS2375`. */
  readonly code: string
  /** The head message, without the continuation lines. */
  readonly message: string
}

const DIAGNOSTIC_LINE = /^(\S.*?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/u

/**
 * Parse `tsc --pretty false` output.
 *
 * Continuation lines — the indented "Type 'X' is not assignable..." that
 * follows a TS2375 — are DROPPED rather than folded into the message. They
 * restate the head in more detail and they are the part most likely to change
 * between TypeScript releases, which would churn every fingerprint in
 * `KNOWN_REPOINT_FINDINGS` on a patch upgrade. The head message already names
 * both types.
 *
 * Anything that is not a diagnostic line — the version banner, a blank line, an
 * "error TS18003: No inputs were found" without a file — is ignored here and
 * caught by the empty-projects rule instead, so that a compiler which failed to
 * start cannot read as a compiler that found nothing wrong.
 */
export const parseDiagnostics = (output: string): ReadonlyArray<Diagnostic> =>
  output
    .split('\n')
    .map((line) => DIAGNOSTIC_LINE.exec(line.trimEnd()))
    .flatMap((match) => {
      if (match === null) {
        return []
      }
      const [, file, line, column, code, message] = match
      if (
        file === undefined ||
        line === undefined ||
        column === undefined ||
        code === undefined ||
        message === undefined
      ) {
        return []
      }
      return [
        {
          file,
          line: Number.parseInt(line, 10),
          column: Number.parseInt(column, 10),
          code,
          message,
        },
      ]
    })

/**
 * A diagnostic's identity, for matching a baseline against a repointed run and
 * for matching `KNOWN_REPOINT_FINDINGS`.
 *
 * LINE AND COLUMN ARE DELIBERATELY EXCLUDED. `fingerprintFinding` in
 * `domain/mirror-contract.ts` includes every discriminating field because its
 * findings are structural and a mirror's shape does not move when somebody adds
 * a blank line. A tsc diagnostic's position does: any edit above it shifts
 * every line number below, and a register keyed on position would go stale on
 * the first unrelated commit in another repository — which would fail this gate
 * for a reason its own contributors could not act on, the exact outcome
 * `KNOWN_FINDINGS` is written to avoid.
 *
 * The cost is real and worth naming: two identical errors in one file collapse
 * to one fingerprint, so a second occurrence of an already-recorded error is
 * suppressed. `describeRepointRun` therefore prints the COUNT alongside the
 * entry, so the arithmetic is visible even when the fingerprint is not.
 */
export const fingerprintDiagnostic = (
  spec: RepointSpec,
  project: string,
  diagnostic: Diagnostic,
): string =>
  `${repointPath(spec)}|${project}|${diagnostic.file}|${diagnostic.code}|${diagnostic.message}`

// ---------------------------------------------------------------------------
// Known outstanding findings
// ---------------------------------------------------------------------------

/**
 * A repoint failure that is REAL, is a BUG, and lives in a repository this one
 * does not own.
 *
 * Same instrument, same argument and same discipline as `KNOWN_FINDINGS` in
 * `domain/mirror-contract.ts`, and the reasoning is not repeated here beyond
 * the one line that matters: recording the defect is strictly better than not
 * running the gate until it is fixed, and strictly better than failing
 * mc-dev-meta's own `verify` for something only another repository's pull
 * request can land.
 *
 * A recorded finding that STOPS reproducing fails the run, with a message
 * saying to delete the entry.
 */
export type KnownRepointFinding = {
  /** `fingerprintDiagnostic`'s output. Produced by running the gate, not written by hand. */
  readonly fingerprint: string
  /** What it is, in a sentence. Not matched on. */
  readonly summary: string
  /** The repository that must land the fix. */
  readonly owner: string
  /** What the fix is. */
  readonly fix: string
}

/**
 * The `FrameServices` divergence, once per repository that carries it.
 *
 * These are not three defects. They are ONE defect in a contract, transcribed
 * into three repositories, which is the failure mode this whole directory
 * exists to make visible — and the reason the entries are listed separately is
 * that each has a different owner and each needs its own pull request.
 *
 * The fix is NOT to change the mirrors. `FrameServices = never` is a correct
 * and deliberate choice for as long as kernel is unpublished, for the reason
 * every mirror header gives: restating `ClockPort` locally would mean a second
 * `Context.Tag` with kernel's identifier string, and two tags that look
 * identical and are not is a far worse defect than a narrower type. The fix is
 * that each repository's STAGE-RUNNING code — its test harness and its preview
 * app, never its shipped rules, which already repoint cleanly — must provide a
 * `ClockPort` on the day the mirror is deleted. That work is knowable now,
 * which is the point of measuring it now.
 */
export const KNOWN_REPOINT_FINDINGS: ReadonlyArray<KnownRepointFinding> = [
  // EMPTY, and it was not empty for long.
  //
  // The first run of this gate recorded seventeen findings across mx-gameplay,
  // mx-ui and mx-redstone, every one of them the same shape: a test context that
  // ran a frame stage without providing a `ClockPort`, against kernel's real
  // `FrameServices = ClockPort`. They were listed here rather than failing the
  // run, because none of them could be fixed from this repository -- each file
  // belongs to another repository with its own pull request.
  //
  // All seventeen are now fixed at the source, and this array is the record of
  // that rather than a backlog. Note what the gate does when an entry here stops
  // reproducing: it SAYS SO, by name, instead of quietly passing. A known-defect
  // list that is allowed to stay more pessimistic than reality is how a project
  // ends up carrying warnings nobody believes -- so the list is checked in both
  // directions and going green is an event that has to be written down.
]

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

/** One project's before/after, as the impure shell measured it. */
export type ProjectResult = {
  /** The tsconfig, e.g. `tsconfig.test.json`. */
  readonly project: string
  /** Diagnostics from the UNTOUCHED copy. Not attributed to the repoint. */
  readonly baseline: ReadonlyArray<Diagnostic>
  /** Diagnostics from the REPOINTED copy. */
  readonly repointed: ReadonlyArray<Diagnostic>
}

/** A diagnostic the repoint introduced, paired with its register entry if it has one. */
export type IntroducedDiagnostic = {
  readonly project: string
  readonly diagnostic: Diagnostic
  readonly entry: KnownRepointFinding | undefined
}

export type RepointOutcome =
  | {
      readonly _tag: 'Repointed'
      readonly spec: RepointSpec
      /** How many import specifiers were rewritten. Zero never reaches here. */
      readonly rewrites: number
      readonly projects: ReadonlyArray<ProjectResult>
      /** New diagnostics with no register entry. These fail the run. */
      readonly introduced: ReadonlyArray<IntroducedDiagnostic>
      /** New diagnostics already recorded. Reported, not failed. */
      readonly known: ReadonlyArray<IntroducedDiagnostic>
    }
  | { readonly _tag: 'Skipped'; readonly spec: RepointSpec; readonly reason: string }

/**
 * Attribute the repointed run's diagnostics against the baseline, then against
 * the register.
 *
 * An EMPTY `projects` list is a FAILURE and is reported as such by
 * `describeRepointRun`, never as agreement — the same rule `compareSurfaces`
 * applies to an empty observation, and for the same reason: a checker that
 * compiled nothing and said "no errors" is worse than no checker.
 */
export const classifyRepoint = (
  spec: RepointSpec,
  rewrites: number,
  projects: ReadonlyArray<ProjectResult>,
  registry: ReadonlyArray<KnownRepointFinding> = KNOWN_REPOINT_FINDINGS,
): RepointOutcome => {
  const introduced: Array<IntroducedDiagnostic> = []
  const known: Array<IntroducedDiagnostic> = []

  for (const project of projects) {
    const before = new Set(
      project.baseline.map((diagnostic) =>
        fingerprintDiagnostic(spec, project.project, diagnostic),
      ),
    )
    for (const diagnostic of project.repointed) {
      const fingerprint = fingerprintDiagnostic(spec, project.project, diagnostic)
      if (before.has(fingerprint)) {
        continue
      }
      const entry = registry.find((candidate) => candidate.fingerprint === fingerprint)
      const item: IntroducedDiagnostic = { project: project.project, diagnostic, entry }
      if (entry === undefined) {
        introduced.push(item)
      } else {
        known.push(item)
      }
    }
  }

  return { _tag: 'Repointed', spec, rewrites, projects, introduced, known }
}

export const failingRepoints = (
  outcomes: ReadonlyArray<RepointOutcome>,
): ReadonlyArray<RepointOutcome> =>
  outcomes.filter(
    (outcome) =>
      outcome._tag === 'Repointed' &&
      (outcome.introduced.length > 0 || outcome.projects.length === 0),
  )

/**
 * Register entries whose repoint WAS performed this run and which did not
 * reproduce.
 *
 * Either the downstream fixed it — in which case the entry must go, or it will
 * sit there suppressing the next occurrence — or it changed, in which case it
 * has already been reported as a new finding. Only entries whose repoint
 * actually ran are reported: an entry for a repository nobody cloned has not
 * been shown to be stale.
 */
export const staleKnownRepointFindings = (
  outcomes: ReadonlyArray<RepointOutcome>,
  registry: ReadonlyArray<KnownRepointFinding> = KNOWN_REPOINT_FINDINGS,
): ReadonlyArray<KnownRepointFinding> => {
  const attempted = outcomes
    .filter((outcome) => outcome._tag === 'Repointed')
    .map((outcome) => `${repointPath(outcome.spec)}|`)
  const matched = new Set(
    outcomes.flatMap((outcome) =>
      outcome._tag === 'Repointed'
        ? outcome.known.flatMap((item) => (item.entry === undefined ? [] : [item.entry.fingerprint]))
        : [],
    ),
  )

  return registry.filter(
    (entry) =>
      !matched.has(entry.fingerprint) &&
      attempted.some((prefix) => entry.fingerprint.startsWith(prefix)),
  )
}

/**
 * 0 when the repoint introduced nothing new and no recorded defect has quietly
 * gone away.
 *
 * Skips never fail; see `REPOINT_SOURCE_NOTE`. Known findings never fail. A
 * stale known finding does, because a register of suppressed checks that nobody
 * prunes is a register of checks that are off.
 */
export const repointRunExitCode = (
  outcomes: ReadonlyArray<RepointOutcome>,
  registry: ReadonlyArray<KnownRepointFinding> = KNOWN_REPOINT_FINDINGS,
): number =>
  failingRepoints(outcomes).length > 0 || staleKnownRepointFindings(outcomes, registry).length > 0
    ? 1
    : 0

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/**
 * The sentence every report begins with.
 *
 * `check:mirrors` learned this lesson the expensive way: a failure whose
 * message did not name the checkout it had read made a stale pin read as real
 * drift and cost a diagnosis (docs/manifest.md §5). This gate reads the same
 * `repos/` and prints the same provenance block — `describeProvenance` from
 * `domain/mirror-contract.ts`, reused rather than restated, because two
 * hand-written copies of a provenance report is the joke this repository exists
 * to stop telling.
 *
 * The second half is this gate's own caveat and has no equivalent there.
 */
export const REPOINT_SOURCE_NOTE: ReadonlyArray<string> = [
  'Every repoint below is performed on a THROWAWAY COPY of those revisions, outside the',
  'workspace: nothing under repos/ is modified, and no downstream package.json gains a',
  'workspace dependency on disk. A workspace repoint is NOT a published-package install —',
  '`exports` and `types` are exercised, `files` and the tarball contents are NOT.',
  'See domain/repoint-plan.ts.',
]

const describeDiagnostic = (item: IntroducedDiagnostic): string =>
  `      ${item.project}  ${item.diagnostic.file}(${String(item.diagnostic.line)},` +
  `${String(item.diagnostic.column)}): ${item.diagnostic.code}: ${item.diagnostic.message}`

/**
 * The whole report, as lines.
 *
 * Returned rather than printed so the message itself is testable — the same
 * convention `domain/workspace.ts` and `describeMirrorRun` use.
 *
 * The skip count is ALWAYS printed. A gate that silently skipped three of three
 * looks exactly like a gate that passed three of three, and the difference is
 * the whole value of the tool.
 */
export const describeRepointRun = (
  outcomes: ReadonlyArray<RepointOutcome>,
  registry: ReadonlyArray<KnownRepointFinding> = KNOWN_REPOINT_FINDINGS,
): ReadonlyArray<string> => {
  const attempted = outcomes.filter((outcome) => outcome._tag === 'Repointed')
  const skipped = outcomes.filter((outcome) => outcome._tag === 'Skipped')
  const lines: Array<string> = []

  if (attempted.length === 0) {
    lines.push(
      `check:repoint: nothing to repoint — 0 of ${String(outcomes.length)} could be attempted.`,
      'This is not a failure. repos/ is gitignored, so a fresh clone has nothing in it; run',
      '`pnpm sync` and then `pnpm install` to make this gate do anything.',
    )
  } else {
    lines.push(
      `check:repoint: repointed and compiled ${String(attempted.length)} of ` +
        `${String(outcomes.length)} mirror(s) (${String(skipped.length)} skipped).`,
    )
  }

  for (const outcome of outcomes) {
    if (outcome._tag === 'Skipped') {
      lines.push(`  skip ${repointPath(outcome.spec)} — ${outcome.reason}`)
      continue
    }
    const status =
      outcome.introduced.length > 0 || outcome.projects.length === 0
        ? 'FAIL'
        : outcome.known.length > 0
          ? 'KNOWN'
          : 'ok   '
    const projects = outcome.projects.map((project) => project.project).join(', ')
    lines.push(
      `  ${status} ${repointPath(outcome.spec)} -> ${outcome.spec.packageName} — ` +
        `${String(outcome.rewrites)} import(s) rewritten, compiled ` +
        `${String(outcome.projects.length)} project(s)` +
        (projects.length > 0 ? ` (${projects})` : '') +
        (outcome.known.length > 0
          ? `, ${String(outcome.known.length)} known outstanding error(s)`
          : ''),
    )
    if (outcome.projects.length === 0) {
      lines.push(
        '       No project was compiled. Its typecheck script named none, so this repoint has',
        '       proved nothing and must not be reported as having passed.',
      )
    }
    for (const item of outcome.introduced) {
      lines.push(describeDiagnostic(item))
    }
  }

  const known = outcomes.flatMap((outcome) =>
    outcome._tag === 'Repointed'
      ? outcome.known.map((item) => ({ spec: outcome.spec, ...item }))
      : [],
  )

  if (known.length > 0) {
    lines.push('')
    lines.push(
      `${String(known.length)} known outstanding repoint error(s), recorded in`,
      'KNOWN_REPOINT_FINDINGS in domain/repoint-plan.ts. Each is REAL: on the day the source is',
      'published and the mirror deleted, that repository does not compile until it is fixed.',
      'None can be fixed from here — the file belongs to another repository with its own pull',
      'request. They do not fail this run, so that mc-dev-meta stays verifiable by its own',
      'contributors. A new one, or a change to one of these, does fail.',
      '',
    )
    // Grouped by register entry, because one entry can match several
    // occurrences once line numbers are out of the fingerprint, and printing
    // the entry once per occurrence would misreport how many defects there are.
    for (const entry of registry) {
      const occurrences = known.filter((item) => item.entry?.fingerprint === entry.fingerprint)
      if (occurrences.length === 0) {
        continue
      }
      lines.push(`  ${entry.summary} (${String(occurrences.length)} occurrence(s))`)
      for (const item of occurrences) {
        lines.push(describeDiagnostic(item))
      }
      lines.push(`      owner: ${entry.owner}`)
      lines.push(`      fix:   ${entry.fix}`)
      lines.push('')
    }
  }

  const stale = staleKnownRepointFindings(outcomes, registry)
  if (stale.length > 0) {
    lines.push('')
    for (const entry of stale) {
      lines.push(
        `KNOWN_REPOINT_FINDINGS records an error that this run did NOT reproduce: ${entry.summary}`,
        'It has been fixed, or it has changed and been reported above as a new error. Either way',
        `the entry in domain/repoint-plan.ts is now wrong and must be deleted (owner: ${entry.owner}).`,
      )
    }
  }

  return lines
}

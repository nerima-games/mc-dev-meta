/**
 * `pnpm check:repoint` — actually perform the repoint every mirror header
 * promises, and compile it.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * The argument for the gate, the list of repoints, the rewrite rule and every
 * decision about what a diagnostic means live in `domain/repoint-plan.ts`,
 * which is pure and unit-tested against fixtures. This file is the shell: it
 * decides which repositories are on disk, makes the throwaway copy, deletes the
 * mirror, rewrites the specifiers, links the package into `node_modules`, runs
 * the downstream's own `tsc`, and turns the resulting plain data over to the
 * domain.
 *
 * ---------------------------------------------------------------------------
 * Why a copy, and why the copy is outside the workspace
 * ---------------------------------------------------------------------------
 *
 * `repos/` MUST NOT BE MODIFIED. It is gitignored, so a stray write there is
 * invisible in `git status`, and `pnpm check:mirrors` reads exactly those files
 * — a gate that quietly edited the input of another gate would produce the most
 * expensive kind of wrong answer. The repoint is therefore performed on a copy
 * in the system temp directory, which is removed when the run ends, pass or
 * fail.
 *
 * The copy is also where the WORKSPACE DEPENDENCY goes, and that constraint is
 * the reason the mirrors exist in the first place: each of the sixteen
 * repositories also builds standalone in its own CI, where a `workspace:*`
 * specifier does not resolve. So no downstream `package.json` on disk may ever
 * gain `@nerima-games/mc-kernel` before it is published, and this gate is
 * careful to add it only to something it is about to delete.
 *
 * ---------------------------------------------------------------------------
 * How the package is resolved without an install
 * ---------------------------------------------------------------------------
 *
 * `pnpm install` in the copy is not an option: it would hit the network, take
 * longer than the rest of `verify` put together, and — because the copy is not
 * a workspace member — would fail on the `workspace:*` specifier it was just
 * given.
 *
 * Instead `node_modules/` in the copy is a SHALLOW LINK FARM: one absolute
 * symlink per entry of the real clone's `node_modules`, plus one more for the
 * package being repointed at, pointing into `repos/`. TypeScript resolves
 * through symlinks to a real path, so the downstream compiles against exactly
 * the dependency tree its own CI installed and exactly the source `repos/`
 * pins. Absolute links rather than relative ones because the copy lives at an
 * unrelated depth, and a relative link farm would resolve to nothing.
 *
 * This is the step that makes the gate stronger than a shape comparison: the
 * import goes through the package's `exports` map and `types` field for real.
 * It is also the step that bounds what the gate can claim — see
 * `REPOINT_SOURCE_NOTE`: no tarball is built, so `files` is never consulted.
 *
 * ---------------------------------------------------------------------------
 * Skip policy
 * ---------------------------------------------------------------------------
 *
 * The same policy `check:mirrors` settled, for the same reason: `repos/` is
 * gitignored and empty in a fresh clone, and a gate that required fifteen other
 * repositories to exist would make the tool that fetches them the last thing in
 * the organisation to become trustworthy. So these are SKIPS, each with a
 * printed reason:
 *   - the mirroring repository is not cloned, or has no `node_modules`;
 *   - the mirror file is gone (which is what SUCCESS looks like eventually);
 *   - the source repository is not cloned;
 *   - the downstream has no `tsc` installed.
 *
 * And these are FAILURES, because they are not absence:
 *   - a repoint spec naming a mirror `MIRROR_SPECS` has never heard of;
 *   - a mirror nothing imports (a spec that rewrote zero specifiers has proved
 *     nothing and must not pass silently);
 *   - a `typecheck` script this cannot read a project out of;
 *   - and of course a diagnostic the repoint introduced.
 *
 * ---------------------------------------------------------------------------
 * Why this is NOT in `pnpm verify`
 * ---------------------------------------------------------------------------
 *
 * `check:mirrors` IS in `verify`, and its header argues the case: it costs
 * nothing when there is nothing to check, and a gate outside `verify` runs on
 * the day somebody remembers it. Both halves of that argument apply here too,
 * and one of them is false in a way that decides it.
 *
 * This gate does not cost nothing. It copies three repositories and runs NINE
 * `tsc` invocations over them — a baseline and a repointed compile for every
 * project each downstream's own `typecheck` names. That is measured in tens of
 * seconds against the rest of `verify`'s few, and `verify` is what a
 * contributor runs before every commit. A gate that makes the pre-commit loop
 * slow enough to skip is a gate that gets skipped with `--no-verify`, which is
 * strictly worse than one that is honestly not in `verify` at all.
 *
 * It is run in CI, on a schedule and before any publish, and `docs/testing.md`
 * §7 says so. The thing `verify` genuinely protects against — drift landing
 * unnoticed — is already covered for these files by `check:mirrors`, which does
 * run every time. This gate answers the larger question that only needs
 * answering before somebody freezes a version.
 */
import { cp, mkdtemp, readdir, readFile, rm, symlink, mkdir, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { describeProvenance } from '../src/domain/mirror-contract'
import {
  classifyRepoint,
  describeRepointRun,
  mirrorModuleName,
  parseDiagnostics,
  repointPath,
  repointRunExitCode,
  rewriteMirrorImports,
  typecheckProjects,
  unmatchedRepointSpecs,
  withWorkspaceDependency,
  REPOINT_SOURCE_NOTE,
  REPOINT_SPECS,
  type Diagnostic,
  type ProjectResult,
  type RepointOutcome,
  type RepointSpec,
} from '../src/domain/repoint-plan'
import { loadManifest, provenanceOf } from './repos-provenance'
import { REPOS_DIRECTORY } from '../src/domain/workspace'

const execFileAsync = promisify(execFile)

const rootDir = process.cwd()

/** Directories never worth copying: huge, rebuilt, or the copy's own concern. */
const UNCOPIED = new Set(['node_modules', '.git', 'coverage', 'dist', '.vite', '.vite-temp'])

/** Raised for the conditions the header calls failures rather than absence. */
class RepointCheckError extends Error {}

const repoDir = (name: string): string => path.join(rootDir, REPOS_DIRECTORY, name)

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

const exists = async (file: string): Promise<boolean> =>
  readFile(file).then(
    () => true,
    () => readdir(file).then(() => true, () => false),
  )

// ---------------------------------------------------------------------------
// The throwaway copy
// ---------------------------------------------------------------------------

/**
 * Copy a clone's source into `destination`, without its `node_modules`.
 *
 * `filter` rather than a post-copy delete: `node_modules` is by far the largest
 * thing in a clone and the copy would spend all its time on files that are
 * about to be thrown away — and on macOS it would follow the pnpm store's
 * symlinks into a tree of tens of thousands of files.
 */
const copySource = async (from: string, to: string): Promise<void> => {
  await cp(from, to, {
    recursive: true,
    // Symlinks inside a clone's SOURCE are copied as symlinks; there are none
    // in practice, and dereferencing would be the surprising choice.
    verbatimSymlinks: true,
    filter: (source) => !UNCOPIED.has(path.basename(source)),
  })
}

/**
 * Build the shallow link farm described in the header.
 *
 * Dotted entries — `.bin` above all, which is where `tsc` lives — are linked
 * too. An earlier cut of this globbed only visible names and produced a copy
 * with no compiler in it, which failed in a way that looked like a broken
 * repository rather than a broken harness.
 */
const linkDependencies = async (
  installed: string,
  destination: string,
  packageName: string,
  packageDir: string,
): Promise<void> => {
  const entries = await readdir(installed)
  await mkdir(destination, { recursive: true })
  await entries.reduce<Promise<void>>(async (accumulated, entry) => {
    await accumulated
    await symlink(path.join(installed, entry), path.join(destination, entry)).catch(() => undefined)
  }, Promise.resolve())

  // A scoped name needs its scope directory to exist first, and it may already
  // exist as a real directory once the package IS published — in which case
  // this link simply loses to the installed copy, which is the correct
  // behaviour: the gate should then be testing the real dependency.
  const target = path.join(destination, packageName)
  await mkdir(path.dirname(target), { recursive: true })
  await symlink(packageDir, target).catch(() => undefined)
}

// ---------------------------------------------------------------------------
// Compiling
// ---------------------------------------------------------------------------

/**
 * Run one project through the DOWNSTREAM'S OWN `tsc`, not this repository's.
 *
 * The version in `repos/<repo>/node_modules` is the one that repository's CI
 * uses, so a diagnostic this gate reports is a diagnostic that repository would
 * actually see. Using mc-dev-meta's TypeScript would make every finding
 * arguable ("that is not the compiler we ship").
 *
 * A non-zero exit is the normal case, not an error: `tsc` exits 2 when it finds
 * type errors, which is exactly what this gate is here to collect. Only a
 * failure to RUN it is exceptional, and that is caught by the caller checking
 * that a compiler exists before getting here.
 */
const compileProject = async (directory: string, project: string): Promise<ReadonlyArray<Diagnostic>> => {
  const compiler = path.join(directory, 'node_modules', '.bin', 'tsc')
  const result = await execFileAsync(compiler, ['-p', project, '--pretty', 'false'], {
    cwd: directory,
    encoding: 'utf8',
    // A repository with a great many errors can outrun the default buffer, and
    // a truncated diagnostic stream would silently under-report.
    maxBuffer: 32 * 1024 * 1024,
  }).catch((cause: unknown) => {
    const shaped = cause as { readonly stdout?: unknown; readonly stderr?: unknown }
    if (typeof shaped.stdout === 'string') {
      return { stdout: shaped.stdout, stderr: '' }
    }
    throw new RepointCheckError(
      `could not run tsc -p ${project} in the scratch copy: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  })
  return parseDiagnostics(result.stdout)
}

// ---------------------------------------------------------------------------
// One repoint
// ---------------------------------------------------------------------------

const skip = (spec: RepointSpec, reason: string): RepointOutcome => ({
  _tag: 'Skipped',
  spec,
  reason,
})

const checkOne = async (
  spec: RepointSpec,
  present: ReadonlySet<string>,
  scratchRoot: string,
): Promise<RepointOutcome> => {
  if (!present.has(spec.repository)) {
    return skip(spec, `${spec.repository} is not cloned`)
  }
  if (!present.has(spec.source)) {
    return skip(spec, `its source ${spec.source} is not cloned`)
  }

  const clone = repoDir(spec.repository)
  const installed = path.join(clone, 'node_modules')
  if (!(await exists(installed))) {
    return skip(spec, `${spec.repository} is cloned but not installed (no node_modules)`)
  }
  if (!(await exists(path.join(installed, '.bin', 'tsc')))) {
    return skip(spec, `${spec.repository} has no tsc installed; run \`pnpm install\``)
  }
  if (!(await exists(path.join(clone, spec.file)))) {
    return skip(
      spec,
      `${spec.file} no longer exists. If ${spec.source} was published and the mirror deleted, ` +
        'delete its row from REPOINT_SPECS in domain/repoint-plan.ts too.',
    )
  }

  const manifestText = await readFile(path.join(clone, 'package.json'), 'utf8')
  const projects = typecheckProjects(manifestText)
  if (projects.length === 0) {
    throw new RepointCheckError(
      `${spec.repository}: could not read any tsconfig project out of its \`typecheck\` script. ` +
        'Compiling nothing must not be reported as a clean repoint.',
    )
  }

  // TWO copies, deliberately. The baseline exists so that a pre-existing error
  // in the downstream is never attributed to the repoint; see the header of
  // domain/repoint-plan.ts.
  const baseDir = path.join(scratchRoot, `${spec.repository}-baseline`)
  const repointDir = path.join(scratchRoot, `${spec.repository}-repointed`)
  const packageDir = repoDir(spec.source)

  await copySource(clone, baseDir)
  await copySource(clone, repointDir)
  await linkDependencies(
    installed,
    path.join(baseDir, 'node_modules'),
    spec.packageName,
    packageDir,
  )
  await linkDependencies(
    installed,
    path.join(repointDir, 'node_modules'),
    spec.packageName,
    packageDir,
  )

  // ---- the repoint itself ----
  await rm(path.join(repointDir, spec.file))

  const moduleName = mirrorModuleName(spec)
  const sources = await sourceFiles(repointDir)
  const rewrites = await sources.reduce<Promise<number>>(async (accumulated, file) => {
    const total = await accumulated
    const text = await readFile(file, 'utf8')
    const result = rewriteMirrorImports(text, moduleName, spec.packageName)
    if (result.rewrites === 0) {
      return total
    }
    await writeFile(file, result.text)
    return total + result.rewrites
  }, Promise.resolve(0))

  if (rewrites === 0) {
    throw new RepointCheckError(
      `${repointPath(spec)}: nothing imports it, so deleting it and repointing proved nothing. ` +
        'Either the mirror is already dead and its REPOINT_SPECS row should go, or the rewrite ' +
        'rule in domain/repoint-plan.ts no longer matches how it is imported.',
    )
  }

  await writeFile(
    path.join(repointDir, 'package.json'),
    withWorkspaceDependency(manifestText, spec.packageName),
  )

  // ---- compile both ----
  const results = await projects.reduce<Promise<ReadonlyArray<ProjectResult>>>(
    async (accumulated, project) => {
      const previous = await accumulated
      const baseline = await compileProject(baseDir, project)
      const repointed = await compileProject(repointDir, project)
      return [...previous, { project, baseline, repointed }]
    },
    Promise.resolve([]),
  )

  return classifyRepoint(spec, rewrites, results)
}

/** Every `.ts` file in the copy, excluding the link farm. */
const sourceFiles = async (directory: string): Promise<ReadonlyArray<string>> => {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true })
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.parentPath.split(path.sep).includes('node_modules'),
    )
    .map((entry) => path.join(entry.parentPath, entry.name))
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export const main = async (): Promise<number> => {
  const unmatched = unmatchedRepointSpecs()
  if (unmatched.length > 0) {
    throw new RepointCheckError(
      `REPOINT_SPECS names ${unmatched.map(repointPath).join(', ')}, which MIRROR_SPECS in ` +
        'domain/mirror-contract.ts does not carry. One of the two registries is wrong; a repoint ' +
        'of a file the mirror gate does not compare is a claim nothing else is watching.',
    )
  }

  const present = await presentDirectories()

  // Printed BEFORE the work, not after, so that a run which then throws has
  // still said what it was looking at — the lesson check:mirrors paid for.
  const provenance = await provenanceOf(
    rootDir,
    [...new Set(REPOINT_SPECS.flatMap((spec) => [spec.repository, spec.source]))]
      .filter((name) => present.has(name))
      .sort(),
    await loadManifest(rootDir, 'check:repoint'),
  )
  for (const line of describeProvenance(provenance)) {
    console.log(line)
  }
  for (const line of REPOINT_SOURCE_NOTE) {
    console.log(line)
  }
  console.log('')

  const scratchRoot = await mkdtemp(path.join(os.tmpdir(), 'mc-dev-meta-repoint-'))
  try {
    // Sequential rather than `Promise.all`: each repoint copies a repository
    // and runs several compilers, and the report has to come out in
    // REPOINT_SPECS order for a diff of two runs to be readable.
    const outcomes = await REPOINT_SPECS.reduce<Promise<ReadonlyArray<RepointOutcome>>>(
      async (accumulated, spec) => {
        const previous = await accumulated
        return [...previous, await checkOne(spec, present, scratchRoot)]
      },
      Promise.resolve([]),
    )

    const exitCode = repointRunExitCode(outcomes)
    for (const line of describeRepointRun(outcomes)) {
      if (exitCode === 0) {
        console.log(line)
      } else {
        console.error(line)
      }
    }

    if (exitCode !== 0) {
      console.error('')
      for (const line of REPOINT_SOURCE_NOTE) {
        console.error(line)
      }
    }

    return exitCode
  } finally {
    // Always, including after a throw. A left-behind copy of three
    // repositories is a slow leak that nobody would notice until a disk did.
    await rm(scratchRoot, { recursive: true, force: true })
  }
}

const isDirectRun = (): boolean => {
  const entry = process.argv[1]
  return entry !== undefined && path.basename(entry) === 'check-repoint.ts'
}

if (isDirectRun()) {
  const code = await main().catch((cause: unknown) => {
    console.error(`check:repoint: ${cause instanceof Error ? cause.message : String(cause)}`)
    return 1
  })
  process.exit(code)
}

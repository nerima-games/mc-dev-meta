/**
 * `pnpm check:features` — validate the cross-repository feature inventory.
 *
 * The pure catalog checks run even when `repos/` is empty. Evidence files in
 * repositories that are not checked out are reported as skipped; a checked-out
 * repository with a missing evidence file is a failure.
 */
import { stat } from 'node:fs/promises'
import path from 'node:path'
import {
  FEATURE_INVENTORY,
  FEATURE_INVENTORY_VALIDATION,
  FEATURE_STATUSES,
  summariseFeatureInventory,
} from '../src/domain/feature-inventory'
import { REPOS_DIRECTORY } from '../src/domain/workspace'

const rootDirectory = process.cwd()
const repositoriesDirectory = path.join(rootDirectory, REPOS_DIRECTORY)

const print = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const printError = (line: string): void => {
  process.stderr.write(`${line}\n`)
}

const repositoryDirectory = (repository: string): string =>
  repository === 'mc-dev-meta' ? rootDirectory : path.join(repositoriesDirectory, repository)

const existsAsFile = async (filePath: string): Promise<boolean> => {
  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}

const existsAsDirectory = async (directoryPath: string): Promise<boolean> => {
  try {
    return (await stat(directoryPath)).isDirectory()
  } catch {
    return false
  }
}

type EvidenceCheck =
  | { readonly kind: 'checked'; readonly entry: string }
  | { readonly kind: 'skipped'; readonly repository: string }
  | { readonly kind: 'missing'; readonly entry: string }

const checkEvidence = async (
  evidence: (typeof FEATURE_INVENTORY)[number]['evidence'][number],
  repositoriesDirectoryExists: boolean,
  featureId: string,
): Promise<EvidenceCheck> => {
  const baseDirectory = repositoryDirectory(evidence.repository)
  if (evidence.repository !== 'mc-dev-meta' && !repositoriesDirectoryExists) {
    return { kind: 'skipped', repository: evidence.repository }
  }
  if (evidence.repository !== 'mc-dev-meta' && !(await existsAsDirectory(baseDirectory))) {
    return { kind: 'skipped', repository: evidence.repository }
  }

  const evidencePath = path.join(baseDirectory, evidence.path)
  return (await existsAsFile(evidencePath))
    ? { kind: 'checked', entry: `${evidence.repository}/${evidence.path}` }
    : { kind: 'missing', entry: `${evidence.repository}/${evidence.path} (${featureId})` }
}

const main = async (): Promise<number> => {
  if (!FEATURE_INVENTORY_VALIDATION.ok) {
    for (const issue of FEATURE_INVENTORY_VALIDATION.issues) {
      printError(`feature inventory: ${issue.code} [${issue.featureId}] ${issue.detail}`)
    }
    return 1
  }

  const repositoriesDirectoryExists = await existsAsDirectory(repositoriesDirectory)
  const checks = await Promise.all(
    FEATURE_INVENTORY.flatMap((feature) =>
      feature.evidence.map((evidence) => checkEvidence(evidence, repositoriesDirectoryExists, feature.id)),
    ),
  )
  const checked = checks.flatMap((check) => (check.kind === 'checked' ? [check.entry] : []))
  const skippedRepositories = new Set(
    checks.flatMap((check) => (check.kind === 'skipped' ? [check.repository] : [])),
  )
  const missing = checks.flatMap((check) => (check.kind === 'missing' ? [check.entry] : []))

  if (missing.length > 0) {
    for (const entry of missing) {
      printError(`feature inventory: missing evidence file ${entry}`)
    }
    return 1
  }

  const skipped = [...skippedRepositories].sort()
  const skippedMessage = skipped.length === 0 ? 'none' : skipped.join(', ')
  const summary = summariseFeatureInventory(FEATURE_INVENTORY)
  const statusMessage = FEATURE_STATUSES.map((status) => `${status}=${String(summary.byStatus[status])}`).join(', ')
  const unresolvedMessage = summary.unresolved.length === 0 ? 'none' : summary.unresolved.join(', ')
  print(
    `feature inventory: ${String(summary.total)} features, ${String(checked.length)} evidence files checked, statuses: ${statusMessage}, unresolved: ${unresolvedMessage}, skipped repositories: ${skippedMessage}`,
  )
  return 0
}

main().then((exitCode) => {
  process.exitCode = exitCode
})

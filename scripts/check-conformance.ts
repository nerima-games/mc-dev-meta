import { stat } from 'node:fs/promises'
import path from 'node:path'
import { CONFORMANCE_CATALOG, validateConformanceCatalog } from '../src/domain/conformance-catalog'
import { REPOS_DIRECTORY } from '../src/domain/workspace'

const root = process.cwd()
const print = (line: string): void => process.stdout.write(`${line}\n`)
const error = (line: string): void => process.stderr.write(`${line}\n`)
const exists = async (file: string): Promise<boolean> => {
  try { return (await stat(file)).isFile() } catch { return false }
}
const base = (owner: string): string => owner === 'mc-dev-meta' ? root : path.join(root, REPOS_DIRECTORY, owner)

const main = async (): Promise<number> => {
  const issues = [...validateConformanceCatalog(CONFORMANCE_CATALOG)]
  for (const record of CONFORMANCE_CATALOG) {
    for (const evidence of record.evidence) {
      if (!(await exists(path.join(base(record.owner), evidence)))) issues.push({ id: record.id, code: 'missing-evidence', detail: `missing evidence: ${record.owner}/${evidence}` })
    }
  }
  if (issues.length > 0) {
    for (const issue of issues) error(`conformance: ${issue.code} [${issue.id}] ${issue.detail}`)
    return 1
  }
  print(`conformance: ${String(CONFORMANCE_CATALOG.length)} records, all evidence files present`)
  return 0
}

main().then((exitCode) => { process.exitCode = exitCode })

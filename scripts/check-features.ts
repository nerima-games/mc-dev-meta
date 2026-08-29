import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import {
  assessFeatures,
  featureAuditExitCode,
  summarizeFeatureAssessments,
  type FeatureRepositorySources,
  type FeatureSource,
} from '../src/domain/feature-audit'
import { FEATURE_SPECS } from '../src/domain/feature-register'

const rootDirectory = process.cwd()
const writeLine = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const readSource = async (sourcePath: string): Promise<FeatureSource | undefined> => {
  try {
    const absolutePath = join(rootDirectory, sourcePath)
    return {
      path: sourcePath,
      content: await readFile(absolutePath, 'utf8'),
    }
  } catch {
    return undefined
  }
}

const readSources = async (paths: ReadonlyArray<string>): Promise<ReadonlyArray<FeatureSource>> => {
  const sources = await Promise.all(paths.map((sourcePath) => readSource(sourcePath)))
  return sources.filter((source): source is FeatureSource => source !== undefined)
}

const requestedPathsByOwner = new Map<string, Set<string>>()
for (const spec of FEATURE_SPECS) {
  const paths = requestedPathsByOwner.get(spec.owner) ?? new Set<string>()
  for (const sourcePath of spec.requiredPaths) {
    paths.add(sourcePath)
  }
  requestedPathsByOwner.set(spec.owner, paths)
}

const repositories: ReadonlyArray<FeatureRepositorySources> = await Promise.all(
  [...requestedPathsByOwner.entries()].map(async ([owner, paths]) => ({
    owner,
    sources: await readSources([...paths]),
  })),
)

const assessments = assessFeatures(FEATURE_SPECS, repositories)
const summary = summarizeFeatureAssessments(assessments)

for (const assessment of assessments) {
  writeLine(`[${assessment.status.toUpperCase()}] ${assessment.spec.id}: ${assessment.spec.title}`)
  for (const evidence of assessment.evidence) {
    const evidencePath = relative(rootDirectory, join(rootDirectory, evidence.path))
    if (evidence.kind === 'missing-path') {
      writeLine(`  missing path: ${evidencePath}`)
    } else {
      writeLine(`  ${evidence.kind}: ${evidencePath} :: ${evidence.marker}`)
    }
  }
  for (const marker of assessment.missingImplementationMarkers) {
    writeLine(`  missing implementation marker: ${marker}`)
  }
}

writeLine(
  `feature-audit summary: complete=${summary.complete} partial=${summary.partial} missing=${summary.missing} unverified=${summary.unverified}`,
)
process.exitCode = featureAuditExitCode(assessments)

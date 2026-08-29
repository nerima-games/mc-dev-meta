export type FeatureStatus = 'complete' | 'partial' | 'missing' | 'unverified'

export type FeatureSpec = {
  readonly id: string
  readonly owner: string
  readonly title: string
  readonly requiredPaths: ReadonlyArray<string>
  readonly implementationMarkers: ReadonlyArray<string>
  readonly gapMarkers: ReadonlyArray<string>
}

export type FeatureSource = {
  readonly path: string
  readonly content: string
}

export type FeatureRepositorySources = {
  readonly owner: string
  readonly sources: ReadonlyArray<FeatureSource>
}

export type FeatureEvidence =
  | {
      readonly kind: 'implementation'
      readonly path: string
      readonly marker: string
    }
  | {
      readonly kind: 'gap'
      readonly path: string
      readonly marker: string
    }
  | {
      readonly kind: 'missing-path'
      readonly path: string
    }

export type FeatureAssessment = {
  readonly spec: FeatureSpec
  readonly status: FeatureStatus
  readonly evidence: ReadonlyArray<FeatureEvidence>
  readonly implementedMarkers: ReadonlyArray<string>
  readonly missingImplementationMarkers: ReadonlyArray<string>
  readonly gapMarkers: ReadonlyArray<string>
  readonly missingPaths: ReadonlyArray<string>
}

export type FeatureSummary = Readonly<Record<FeatureStatus, number>>

const sourceByPath = (sources: ReadonlyArray<FeatureSource>): ReadonlyMap<string, FeatureSource> =>
  new Map(sources.map((source) => [source.path, source] as const))

const pathContaining = (
  paths: ReadonlyArray<string>,
  sources: ReadonlyMap<string, FeatureSource>,
  marker: string,
): string | undefined =>
  paths.find((path) => sources.get(path)?.content.includes(marker) === true)

export const assessFeature = (
  spec: FeatureSpec,
  sources: ReadonlyArray<FeatureSource>,
): FeatureAssessment => {
  const sourcesByPath = sourceByPath(sources)
  const missingPaths = spec.requiredPaths.filter((path) => !sourcesByPath.has(path))
  const implementedMarkers = spec.implementationMarkers.filter(
    (marker) => pathContaining(spec.requiredPaths, sourcesByPath, marker) !== undefined,
  )
  const missingImplementationMarkers = spec.implementationMarkers.filter(
    (marker) => !implementedMarkers.includes(marker),
  )
  const gapMarkers = spec.gapMarkers.filter(
    (marker) => pathContaining(spec.requiredPaths, sourcesByPath, marker) !== undefined,
  )

  const evidence: Array<FeatureEvidence> = [
    ...missingPaths.map((path): FeatureEvidence => ({ kind: 'missing-path', path })),
    ...implementedMarkers.map((marker): FeatureEvidence => ({
      kind: 'implementation',
      path: pathContaining(spec.requiredPaths, sourcesByPath, marker)!,
      marker,
    })),
    ...gapMarkers.map((marker): FeatureEvidence => ({
      kind: 'gap',
      path: pathContaining(spec.requiredPaths, sourcesByPath, marker)!,
      marker,
    })),
  ]

  const status: FeatureStatus =
    missingPaths.length > 0
      ? 'missing'
      : gapMarkers.length > 0
        ? implementedMarkers.length > 0
          ? 'partial'
          : 'missing'
        : implementedMarkers.length === spec.implementationMarkers.length && implementedMarkers.length > 0
          ? 'complete'
          : implementedMarkers.length > 0
            ? 'partial'
            : 'unverified'

  return {
    spec,
    status,
    evidence,
    implementedMarkers,
    missingImplementationMarkers,
    gapMarkers,
    missingPaths,
  }
}

export const assessFeatures = (
  specs: ReadonlyArray<FeatureSpec>,
  repositories: ReadonlyArray<FeatureRepositorySources>,
): ReadonlyArray<FeatureAssessment> => {
  const sourcesByOwner = new Map(repositories.map((repository) => [repository.owner, repository.sources] as const))

  return specs.map((spec) => assessFeature(spec, sourcesByOwner.get(spec.owner) ?? []))
}

export const summarizeFeatureAssessments = (
  assessments: ReadonlyArray<FeatureAssessment>,
): FeatureSummary => {
  const summary: Record<FeatureStatus, number> = {
    complete: 0,
    partial: 0,
    missing: 0,
    unverified: 0,
  }

  for (const assessment of assessments) {
    summary[assessment.status] += 1
  }

  return summary
}

export const featureAuditExitCode = (assessments: ReadonlyArray<FeatureAssessment>): 0 | 1 =>
  assessments.every((assessment) => assessment.status === 'complete') ? 0 : 1

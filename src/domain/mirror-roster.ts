export type RosterProbe = {
  readonly mirrorExport: string
  readonly owner: string
  readonly sourceExport: string
}

export type RosterObservation = {
  readonly name: string
  readonly members: ReadonlyArray<string>
}

export type RosterFinding =
  | {
      readonly _tag: 'RosterDiffers'
      readonly symbol: string
      readonly owner: string
      readonly source: string
      readonly onlyInMirror: ReadonlyArray<string>
      readonly onlyInSource: ReadonlyArray<string>
      readonly orderDiffers: boolean
    }
  | {
      readonly _tag: 'RosterProbeEmpty'
      readonly symbol: string
      readonly owner: string
      readonly source: string
    }

const findRoster = (
  observations: ReadonlyArray<RosterObservation>,
  name: string,
): RosterObservation | undefined => observations.find((observation) => observation.name === name)

export const compareRosters = (
  probes: ReadonlyArray<RosterProbe>,
  mirror: ReadonlyArray<RosterObservation>,
  source: ReadonlyArray<RosterObservation>,
): ReadonlyArray<RosterFinding> =>
  probes.flatMap((probe): ReadonlyArray<RosterFinding> => {
    const mirrorRoster = findRoster(mirror, probe.mirrorExport)
    const sourceRoster = findRoster(source, probe.sourceExport)

    if (mirrorRoster === undefined || sourceRoster === undefined) {
      return [
        {
          _tag: 'RosterProbeEmpty' as const,
          symbol: probe.mirrorExport,
          owner: probe.owner,
          source: probe.sourceExport,
        },
      ]
    }

    const sourceMembers = new Set(sourceRoster.members)
    const onlyInMirror = mirrorRoster.members.filter((member) => !sourceMembers.has(member))
    const mirrorMembers = new Set(mirrorRoster.members)
    const onlyInSource = sourceRoster.members.filter((member) => !mirrorMembers.has(member))
    const orderDiffers =
      onlyInMirror.length === 0 &&
      onlyInSource.length === 0 &&
      (mirrorRoster.members.length !== sourceRoster.members.length ||
        mirrorRoster.members.some((member, index) => member !== sourceRoster.members[index]))

    if (onlyInMirror.length === 0 && onlyInSource.length === 0 && !orderDiffers) {
      return []
    }

    return [
      {
        _tag: 'RosterDiffers' as const,
        symbol: probe.mirrorExport,
        owner: probe.owner,
        source: probe.sourceExport,
        onlyInMirror,
        onlyInSource,
        orderDiffers,
      },
    ]
  })

import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  CIVIC_PANEL_SHORT_GROUPS_SHOWN,
  civicPanelShortGroups,
  decodePrecinctPair,
  MAX_LIST_SAMPLE_SIZE,
  UNDERREPRESENTED_GROUP_NAMES,
  type CivicPanelComposition,
  type CivicPanelReachChannel,
  type CivicPanelReachGroup,
  type CivicPanelReachList,
  type CivicPanelReachOption,
  type CivicPanelReachOptions,
  type CivicPanelShortGroup,
  type CreateCivicPanelReachListInput,
} from '@goodparty_org/contracts'
import { PinoLogger } from 'nestjs-pino'
import {
  CivicPanelStatus,
  ContactStatusField,
  Organization,
} from '../../generated/prisma'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import type {
  ReachGroupCell,
  ReachHomes,
} from '@/peopleDb/databricks/districtCensusSql.util'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import { ContactsService } from './contacts.service'
import { CivicPanelSummaryService } from './civicPanelSummary.service'
import { ManagedCivicPanelService } from './managedCivicPanel.service'

type ShortGroup = Extract<CivicPanelReachGroup, { kind: 'group' }>['group']

const GROUP_CELLS: Record<ShortGroup, ReachGroupCell> = {
  age18to24: { kind: 'age', band: '18to24' },
  age25to34: { kind: 'age', band: '25to34' },
  age35to44: { kind: 'age', band: '35to44' },
  age45to54: { kind: 'age', band: '45to54' },
  age55to64: { kind: 'age', band: '55to64' },
  age65plus: { kind: 'age', band: '65plus' },
  men: { kind: 'gender', value: 'male' },
  women: { kind: 'gender', value: 'female' },
  white: { kind: 'race', value: 'white' },
  black: { kind: 'race', value: 'black' },
  hispanic: { kind: 'race', value: 'hispanic' },
  asian: { kind: 'race', value: 'asian' },
}

// A group the civic panel page lists as short, in the census cells its
// seats were counted in, so a list holds the same people the row counts.
export const reachGroupCell = (group: CivicPanelReachGroup): ReachGroupCell => {
  switch (group.kind) {
    case 'group':
      return GROUP_CELLS[group.group]
    case 'tract':
      return { kind: 'tract', tract: group.key }
    case 'precinct':
      return { kind: 'precinct', ...decodePrecinctPair(group.key) }
  }
}

const plural = (n: number, one: string, many: string): string =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

// A short group's row as the Chief of Staff names it: a tract by its
// human name ("around Pine St", "West Asheville"), a precinct by its
// number, else the group's own name.
const shortGroupName = (
  row: CivicPanelShortGroup,
  placeKind: CivicPanelComposition['placeKind'],
  place: string | null,
): string => {
  if (row.kind === 'group') return UNDERREPRESENTED_GROUP_NAMES[row.group]
  if (row.place.label) return row.place.label
  return placeKind === 'precinct'
    ? `Precinct ${row.place.name}`
    : `a part of ${place ?? 'your district'}`
}

const reachGroupOf = (
  row: CivicPanelShortGroup,
  placeKind: CivicPanelComposition['placeKind'],
): CivicPanelReachGroup | null => {
  if (row.kind === 'place') return { kind: placeKind, key: row.key }
  return row.group === 'unreachedAreas'
    ? null
    : { kind: 'group', group: row.group }
}

// A place is walked: its doors, or its landlines when every home there has
// a cell phone on file. An age, gender or race group is spread across the
// district, so it is called where it has landlines. Null when neither
// reaches anyone.
const channelFor = (
  row: CivicPanelShortGroup,
  homes: ReachHomes,
): CivicPanelReachChannel | null => {
  const [first, second]: [CivicPanelReachChannel, CivicPanelReachChannel] =
    row.kind === 'place' ? ['door', 'phone'] : ['phone', 'door']
  const reaches = (channel: CivicPanelReachChannel) =>
    (channel === 'door' ? homes.noCell : homes.landline) > 0
  if (reaches(first)) return first
  return reaches(second) ? second : null
}

export const reachOptionWords = (
  row: CivicPanelShortGroup,
  name: string,
  channel: CivicPanelReachChannel,
  homes: number,
): { label: string; detail: string } => {
  const where =
    row.kind === 'place'
      ? name.startsWith('around ')
        ? name
        : `in ${name}`
      : null
  const label =
    channel === 'door'
      ? where
        ? `Knock doors ${where}`
        : `Knock doors for ${name}`
      : where
        ? `Call residents ${where}`
        : `Call ${name}`
  const short = plural(row.need - row.have, 'seat', 'seats')
  const reach = channel === 'door' ? 'no cell phone on file' : 'a landline'
  const count = where
    ? `${plural(homes, 'home there has', 'homes there have')} ${reach}`
    : `${plural(homes, 'of their homes has', 'of their homes have')} ${reach}`
  return {
    label: label.charAt(0).toUpperCase() + label.slice(1),
    detail: `${short} short. ${count}.`,
  }
}

// Reaching the residents a civic panel's texts could not, at the door or on
// a call: the people in a group still short of its seats with no cell phone
// on file (and for a call, a landline), saved as an ordinary list for the
// existing door knocking and phone banking flows. Joining stays a yes
// marked at the door or on the call.
@Injectable()
export class CivicPanelReachService {
  constructor(
    private readonly contactStatusService: ContactStatusService,
    private readonly contactsService: ContactsService,
    private readonly voterQuery: VoterQueryService,
    private readonly voterFileFilterService: VoterFileFilterService,
    private readonly summaries: CivicPanelSummaryService,
    private readonly managedPanels: ManagedCivicPanelService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CivicPanelReachService.name)
  }

  // The short groups the civic panel page lists first, each with the one
  // way that reaches the most of it: what the Chief of Staff offers once
  // every resident a text can reach has an invite. A group a door or a
  // call would reach nobody in is left out, and a failed warehouse read
  // offers nothing rather than a guess.
  async optionsFor(
    organization: Organization,
  ): Promise<CivicPanelReachOptions> {
    const [summary, place] = await Promise.all([
      this.summaries.summaryFor(organization),
      this.managedPanels.districtPlace(organization),
    ])
    const none = { place, mostlyNoCell: false, options: [] }
    const { composition } = summary
    if (!composition) return none
    const rows = civicPanelShortGroups({
      composition,
      members: summary.members,
      goal: summary.progress.goal,
    }).flatMap((row) => {
      const group = reachGroupOf(row, composition.placeKind)
      return group ? [{ row, group }] : []
    })
    const shown = rows.slice(0, CIVIC_PANEL_SHORT_GROUPS_SHOWN)
    if (shown.length === 0) return none
    const [excludeIds, district] = await Promise.all([
      this.onOrOffThePanel(organization),
      this.contactsService.resolveEligibleDistrict(organization),
    ])
    let counted: {
      row: CivicPanelShortGroup
      group: CivicPanelReachGroup
      homes: ReachHomes
    }[]
    try {
      counted = await Promise.all(
        shown.map(async ({ row, group }) => ({
          row,
          group,
          homes: await this.voterQuery.findReachHomes(
            district.districtId,
            district.dataset,
            { group: reachGroupCell(group), excludeIds },
          ),
        })),
      )
    } catch (err) {
      // A warehouse read that fails offers no group rather than a guess at
      // who a door or a call reaches.
      this.logger.warn(
        { err, organizationSlug: organization.slug },
        'civic panel reach homes read failed',
      )
      return none
    }
    const places = counted.filter(({ row }) => row.kind === 'place')
    const placeHomes = places.reduce((sum, { homes }) => sum + homes.homes, 0)
    const placeNoCell = places.reduce((sum, { homes }) => sum + homes.noCell, 0)
    const options = counted.flatMap(
      ({ row, group, homes }): CivicPanelReachOption[] => {
        const channel = channelFor(row, homes)
        if (!channel) return []
        const count = channel === 'door' ? homes.noCell : homes.landline
        return [
          {
            ...reachOptionWords(
              row,
              shortGroupName(row, composition.placeKind, place),
              channel,
              count,
            ),
            group,
            channel,
            seatsShort: row.need - row.have,
            homes: count,
          },
        ]
      },
    )
    // Two unnamed tracts ("a part of Asheville") read the same, and a pick
    // is matched by its words, so only the first of a label is offered.
    const labels = new Set<string>()
    return {
      place,
      mostlyNoCell: placeHomes > 0 && placeNoCell * 2 > placeHomes,
      options: options.filter(({ label }) => {
        if (labels.has(label)) return false
        labels.add(label)
        return true
      }),
    }
  }

  async createList(
    organization: Organization,
    input: CreateCivicPanelReachListInput,
  ): Promise<CivicPanelReachList> {
    if (!organization.slug.startsWith('eo-')) {
      throw new BadRequestException(
        'The civic panel is not available for this organization',
      )
    }
    const [excludeIds, district] = await Promise.all([
      this.onOrOffThePanel(organization),
      this.contactsService.resolveEligibleDistrict(organization),
    ])
    const personIds = await this.voterQuery.findReachPeople(
      district.districtId,
      district.dataset,
      {
        group: reachGroupCell(input.group),
        channel: input.channel,
        excludeIds,
        limit: MAX_LIST_SAMPLE_SIZE,
      },
    )
    if (personIds.length === 0) {
      throw new UnprocessableEntityException(
        'Nobody in this group is left to reach this way.',
      )
    }
    const list = await this.voterFileFilterService.create(
      organization.slug,
      {
        name: input.name,
        sample: { size: personIds.length },
        ...(input.channel === 'phone' && { hasLandline: true }),
      },
      null,
      personIds,
    )
    return { listId: list.id, people: personIds.length }
  }

  // The members, and everyone who left: a door or a call asks neither.
  private onOrOffThePanel(organization: Organization): Promise<string[]> {
    return this.contactStatusService.personIdsByFieldValue(
      organization.slug,
      ContactStatusField.civic_panel,
      [CivicPanelStatus.member, CivicPanelStatus.left],
    )
  }
}

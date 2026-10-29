import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  decodePrecinctPair,
  MAX_LIST_SAMPLE_SIZE,
  type CivicPanelReachGroup,
  type CivicPanelReachList,
  type CreateCivicPanelReachListInput,
} from '@goodparty_org/contracts'
import {
  CivicPanelStatus,
  ContactStatusField,
  Organization,
} from '../../generated/prisma'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import type { ReachGroupCell } from '@/peopleDb/databricks/districtCensusSql.util'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import { ContactsService } from './contacts.service'

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
  ) {}

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

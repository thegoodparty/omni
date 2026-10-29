import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  answersNeeded,
  cityNameCase,
  CIVIC_PANEL_JOIN_LINE,
  CIVIC_PANEL_JOIN_LINES,
  findCivicPanelJoinLine,
  findCivicPanelLeaveLine,
  panelGoalMembers,
  type ApproveManagedCivicPanelInput,
  type ManagedCivicPanel,
  type ManagedCivicPanelResponse,
  type UpdateManagedCivicPanelInput,
} from '@goodparty_org/contracts'
import {
  CivicPanelStatus,
  ContactStatusField,
  ManagedCivicPanelStatus,
  Organization,
  Prisma,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { assertServeSmsLockedLines } from '@/outreach/util/serveSmsLockedLines.util'
import {
  CENSUS_COMPOSITION_SOURCE,
  type CensusCompositionSource,
} from '@/priorities/services/censusComposition'
import { adultAgeBandShares } from '@/priorities/util/censusSexAge.util'
import { AnalyticsService } from '@/analytics/analytics.service'
import { trackForOffice } from '@/priorities/util/priorityAnalytics.util'
import { EVENTS } from 'src/vendors/segment/segment.types'
import { managedPanelStatusChanged } from '../utils/managedPanelAnalytics.util'
import { ContactsService } from './contacts.service'
import { CensusTractNameService } from './censusTractName.service'
import { managedPanelSchedule } from '../utils/managedPanelSchedule.util'

type Row = Prisma.ManagedCivicPanelGetPayload<{
  include: { waves: { select: { sentAt: true; replyWindowEndsAt: true } } }
}>

const WAVES_INCLUDE = {
  waves: { select: { sentAt: true, replyWindowEndsAt: true } },
} as const

type Action = UpdateManagedCivicPanelInput['action']

// Which statuses each action may leave from. A ready or exhausted panel has
// nothing left to send, so there is nothing to pause or resume, but it can
// still be stopped.
const ALLOWED_FROM: Record<Action, ManagedCivicPanelStatus[]> = {
  pause: [ManagedCivicPanelStatus.building],
  resume: [ManagedCivicPanelStatus.paused],
  stop: [
    ManagedCivicPanelStatus.building,
    ManagedCivicPanelStatus.paused,
    ManagedCivicPanelStatus.ready,
    ManagedCivicPanelStatus.exhausted,
  ],
}

// The civic panel GoodParty builds for an office in the official's name.
// See the contacts AGENTS.md, "Managed civic panel".
@Injectable()
export class ManagedCivicPanelService extends createPrismaBase(
  MODELS.ManagedCivicPanel,
) {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly contactStatusService: ContactStatusService,
    @Inject(CENSUS_COMPOSITION_SOURCE)
    private readonly census: CensusCompositionSource,
    private readonly tractNames: CensusTractNameService,
    private readonly organizations: OrganizationsService,
    private readonly analytics: AnalyticsService,
  ) {
    super()
  }

  async read(organization: Organization): Promise<ManagedCivicPanelResponse> {
    assertServeOrg(organization)
    const row = await this.model.findUnique({
      where: { organizationSlug: organization.slug },
      include: WAVES_INCLUDE,
    })
    return { panel: row ? await this.toResponse(organization, row) : null }
  }

  // Idempotent per office: an existing enrollment comes back unchanged
  // unless it was stopped, which this approval starts again.
  async approve(
    organization: Organization,
    input: ApproveManagedCivicPanelInput,
    userId: number,
  ): Promise<ManagedCivicPanelResponse> {
    assertServeOrg(organization)
    assertManagedPanelInvite(input.inviteMessage)
    const existing = await this.model.findUnique({
      where: { organizationSlug: organization.slug },
      select: { status: true },
    })
    if (existing && existing.status !== ManagedCivicPanelStatus.stopped) {
      return this.read(organization)
    }
    const approval = {
      status: ManagedCivicPanelStatus.building,
      inviteMessage: input.inviteMessage,
      consentVersion: input.consentVersion,
      approvedAt: new Date(),
      approvedByUserId: userId,
      goalMembers: panelGoalMembers(
        await this.districtAnswersNeeded(organization),
      ),
    }
    if (existing) {
      // Conditional on stopped, so of two racing re-approvals one writes.
      const { count } = await this.model.updateMany({
        where: {
          organizationSlug: organization.slug,
          status: ManagedCivicPanelStatus.stopped,
        },
        data: {
          ...approval,
          readyAt: null,
          readyEmailSentAt: null,
          pausedAt: null,
          stoppedAt: null,
        },
      })
      if (count === 0) return this.read(organization)
      this.nameDistrictTracts(organization)
      return this.approved(organization, true)
    }
    try {
      await this.model.create({
        data: { ...approval, organizationSlug: organization.slug },
      })
      this.nameDistrictTracts(organization)
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err
      return this.read(organization)
    }
    return this.approved(organization, false)
  }

  // The approval that this call made, not one it found, is the one tracked.
  private async approved(
    organization: Organization,
    reapproval: boolean,
  ): Promise<ManagedCivicPanelResponse> {
    const response = await this.read(organization)
    const { panel } = response
    if (panel) {
      void trackForOffice(
        this.client,
        this.analytics,
        { organizationSlug: organization.slug },
        [
          [
            EVENTS.Contacts.CivicPanelInviteApproved,
            {
              goalMembers: panel.goalMembers,
              freeTextCap: panel.freeTextCap,
              firstSendDate: panel.progress.firstSendDate,
              reapproval,
              product: 'serve',
            },
          ],
          ...(reapproval
            ? [
                managedPanelStatusChanged({
                  from: ManagedCivicPanelStatus.stopped,
                  to: ManagedCivicPanelStatus.building,
                  members: panel.progress.members,
                  changedBy: 'official',
                }),
              ]
            : []),
        ],
      )
    }
    return response
  }

  // What the Chief of Staff's explanation names: the place, the seats, and
  // the share of the district's adults 65 or older. Each read that fails
  // leaves its part unknown rather than failing the explanation.
  async explainerFacts(organization: Organization): Promise<{
    place: string | null
    goalMembers: number
    olderShare: number | null
  }> {
    assertServeOrg(organization)
    const [place, row, olderShare] = await Promise.all([
      this.districtPlace(organization),
      this.model.findUnique({
        where: { organizationSlug: organization.slug },
        select: { status: true, goalMembers: true },
      }),
      this.districtOlderShare(organization),
    ])
    const goalMembers =
      row && row.status !== ManagedCivicPanelStatus.stopped
        ? row.goalMembers
        : panelGoalMembers(await this.districtAnswersNeeded(organization))
    return { place, goalMembers, olderShare }
  }

  // "Asheville", the way Serve copy names the office's place, or null.
  async districtPlace(organization: Organization): Promise<string | null> {
    try {
      const district = await this.organizations.getDistrictForOrgSlug(
        organization.slug,
      )
      const city = district?.l2Name
        ? OrganizationsService.extractCityFromDistrictName(district.l2Name)
        : null
      return city ? cityNameCase(city) : null
    } catch {
      return null
    }
  }

  private async districtOlderShare(
    organization: Organization,
  ): Promise<number | null> {
    try {
      const district =
        await this.contactsService.resolveEligibleDistrict(organization)
      const inputs = await this.census.weightingInputs({
        ...district,
        personIds: [],
      })
      return inputs
        ? (adultAgeBandShares(inputs.census.district)?.['65plus'] ?? null)
        : null
    } catch {
      return null
    }
  }

  // Names every tract in the district in the background, so the panel page
  // shows names, not numbers, by the time the official first opens it. The
  // summary read still fills any it missed.
  private nameDistrictTracts(organization: Organization): void {
    void (async () => {
      const district =
        await this.contactsService.resolveEligibleDistrict(organization)
      const inputs = await this.census.weightingInputs({
        ...district,
        personIds: [],
      })
      const tracts = [...(inputs?.census.tractAdults.keys() ?? [])]
      if (tracts.length > 0) await this.tractNames.fillMissing(district, tracts)
    })().catch(() => undefined)
  }

  async update(
    organization: Organization,
    action: Action,
  ): Promise<ManagedCivicPanelResponse> {
    assertServeOrg(organization)
    const now = new Date()
    const before = await this.model.findUnique({
      where: { organizationSlug: organization.slug },
      select: { status: true },
    })
    const data: Prisma.ManagedCivicPanelUpdateManyMutationInput =
      action === 'pause'
        ? { status: ManagedCivicPanelStatus.paused, pausedAt: now }
        : action === 'resume'
          ? { status: ManagedCivicPanelStatus.building, pausedAt: null }
          : { status: ManagedCivicPanelStatus.stopped, stoppedAt: now }
    // Conditional on the status read, so a transition never lands on a
    // status that changed underneath it.
    const { count } = await this.model.updateMany({
      where: {
        organizationSlug: organization.slug,
        status: { in: ALLOWED_FROM[action] },
      },
      data,
    })
    if (count === 0) {
      const existing = await this.model.findUnique({
        where: { organizationSlug: organization.slug },
        select: { status: true },
      })
      if (!existing) {
        throw new NotFoundException('This office has no managed civic panel')
      }
      throw new ConflictException(
        `A ${existing.status} civic panel can't ${action}`,
      )
    }
    const response = await this.read(organization)
    if (before && response.panel) {
      void trackForOffice(
        this.client,
        this.analytics,
        { organizationSlug: organization.slug },
        [
          managedPanelStatusChanged({
            from: before.status,
            to: response.panel.status,
            members: response.panel.progress.members,
            changedBy: 'official',
          }),
        ],
      )
    }
    return response
  }

  private async toResponse(
    organization: Organization,
    row: Row,
  ): Promise<ManagedCivicPanel> {
    const members = await this.contactStatusService.personIdsByFieldValue(
      organization.slug,
      ContactStatusField.civic_panel,
      [CivicPanelStatus.member],
    )
    const sentAt = (w: Row['waves'][number]) => w.sentAt?.getTime() ?? -1
    const sent = row.waves.filter((w) => w.sentAt !== null)
    const latest = [...sent].sort((a, b) => sentAt(b) - sentAt(a))[0]
    return {
      id: row.id,
      status: row.status,
      inviteMessage: row.inviteMessage,
      consentVersion: row.consentVersion,
      approvedAt: row.approvedAt,
      approvedByUserId: row.approvedByUserId,
      goalMembers: row.goalMembers,
      freeTextCap: row.freeTextCap,
      freeTextsUsed: row.freeTextsUsed,
      readyAt: row.readyAt,
      pausedAt: row.pausedAt,
      stoppedAt: row.stoppedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      progress: {
        members: members.length,
        goalMembers: row.goalMembers,
        wavesSent: sent.length,
        nextWaveAt:
          row.status === ManagedCivicPanelStatus.building
            ? (latest?.replyWindowEndsAt ?? null)
            : null,
        ...managedPanelSchedule(row.approvedAt),
      },
    }
  }

  // The goal's source: the answers a good read of the district
  // needs, or the most any district needs when it cannot be read.
  private async districtAnswersNeeded(
    organization: Organization,
  ): Promise<number> {
    try {
      const district =
        await this.contactsService.resolveEligibleDistrict(organization)
      return (
        (await this.census.districtAnswersNeeded(district)) ?? answersNeeded()
      )
    } catch {
      return answersNeeded()
    }
  }
}

const assertServeOrg = (organization: Organization): void => {
  if (!organization.slug.startsWith('eo-')) {
    throw new BadRequestException(
      'The civic panel is not available for this organization',
    )
  }
}

// A draft written before the JOIN line's last rewrite still approves, but
// never one that names the panel by its earlier name: every wave texts it.
const APPROVABLE_JOIN_LINES: readonly string[] = CIVIC_PANEL_JOIN_LINES.filter(
  (line) => line.includes('my civic panel'),
)

// The build_citizens_panel text's locked lines: a civic panel JOIN line, the
// STOP opt-out, and no second panel line. Every wave sends these words, so
// the reply reader must recognize the JOIN line.
export const assertManagedPanelInvite = (message: string): void => {
  const joinLine = findCivicPanelJoinLine(message)?.text
  if (joinLine === undefined || !APPROVABLE_JOIN_LINES.includes(joinLine)) {
    throw new BadRequestException(
      `Your invite is missing its join line. Add "${CIVIC_PANEL_JOIN_LINE}" and try again.`,
    )
  }
  if (findCivicPanelLeaveLine(message) !== null) {
    throw new BadRequestException(
      "An invite doesn't offer a way to leave the panel. Remove that line and try again.",
    )
  }
  assertServeSmsLockedLines(message)
}

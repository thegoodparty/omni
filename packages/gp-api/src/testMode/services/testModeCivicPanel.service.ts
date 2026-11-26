import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  answersNeeded,
  civicPanelMilestoneAt,
  MANAGED_CIVIC_PANEL_CONSENT_VERSION,
  panelGoalMembers,
  TestModeCivicPanelPreset,
} from '@goodparty_org/contracts'
import { ConflictException, Injectable } from '@nestjs/common'
import { addMinutes, subDays, subMinutes } from 'date-fns'
import { randomUUID } from 'node:crypto'
import { v5 as uuidv5 } from 'uuid'
import {
  CivicPanelStatus,
  ContactStatusField,
  ContactStatusSource,
  ElectedOffice,
  ManagedCivicPanelStatus,
  OutreachStatus,
  OutreachType,
  PollIndividualMessageSender,
  Prisma,
  PriorityAnswerSource,
  PrioritySource,
  SynthesisRunStatus,
  SynthesisScope,
} from '../../generated/prisma'
import {
  CIVIC_PANEL_FIXTURE_INVITE,
  CIVIC_PANEL_FIXTURE_PRIORITY,
  CIVIC_PANEL_FIXTURE_SEND,
  CIVIC_PANEL_FIXTURE_THEMES,
} from '../fixtures/civicPanel.fixture'

// Marks the civic panel joins this module wrote, so a preset rewrites only
// its own members and never one the official added by hand.
const FIXTURE_SOURCE_PREFIX = 'test-mode-fixture:'
const FIXTURE_PERSON_NAMESPACE = '3f6c2a1e-7d4b-4c8e-9a51-2b7e0d9c4f13'
const FIXTURE_ENGINE = 'test-mode'
const JOINED_OVER_DAYS = 14
const ASKED_DAYS_AGO = 2
const TX_TIMEOUT_MS = 60_000
const ANSWERS_COMING_SHARE = 0.4

const PANEL_PRESETS: TestModeCivicPanelPreset[] = [
  'building',
  'first_yes',
  'can_compare',
  'halfway',
  'full',
]

// Made-up people, the same ones for an org every time, so a preset that
// adds members keeps the ones already shown. None is a voter file id.
const fixturePersonId = (organizationSlug: string, index: number) =>
  uuidv5(`${organizationSlug}:${index}`, FIXTURE_PERSON_NAMESPACE)

// 202-555-0100 through 0199 are reserved for fiction; nothing texts them.
const fixturePhone = (index: number) =>
  `+1202555${String(100 + (index % 100)).padStart(4, '0')}`

// The answer presets ask a full panel, and a good read needs
// answersNeeded() of them, so a panel approved with a smaller district goal
// still gets enough members to answer.
const membersFor = (preset: TestModeCivicPanelPreset, goal: number) => {
  switch (preset) {
    case 'none':
    case 'building':
      return 0
    case 'first_yes':
      return civicPanelMilestoneAt('firstYes', goal)
    case 'can_compare':
      return Math.min(civicPanelMilestoneAt('canCompare', goal), goal)
    case 'halfway':
      return civicPanelMilestoneAt('halfway', goal)
    case 'full':
      return goal
    default:
      return Math.max(goal, answersNeeded())
  }
}

const answersFor = (
  preset: TestModeCivicPanelPreset,
  members: number,
): number | null => {
  const needed = answersNeeded()
  switch (preset) {
    case 'asked':
      return 0
    case 'answers_coming':
      return Math.min(Math.round(needed * ANSWERS_COMING_SHARE), members)
    case 'answers_in':
      return Math.min(needed, members)
    default:
      return null
  }
}

const replyAt = (index: number) => {
  const themes = CIVIC_PANEL_FIXTURE_THEMES
  const theme = themes[index % themes.length]!
  const round = Math.floor(index / themes.length)
  return {
    themeIndex: index % themes.length,
    code: theme.code,
    content: theme.replies[round % theme.replies.length]!,
  }
}

// The Test mode civic panel family: one managed civic panel walked through
// each milestone with made-up members, then one shared priority asked of
// it with made-up answers. Every row hangs off the test org and goes with
// it; the wave job, answer coding and the priority read skip test orgs, so
// nothing here texts anyone or reaches a model or the warehouse.
@Injectable()
export class TestModeCivicPanelService extends createPrismaBase(
  MODELS.ManagedCivicPanel,
) {
  async apply(
    office: ElectedOffice,
    actorUserId: number,
    preset: TestModeCivicPanelPreset,
  ): Promise<void> {
    const organizationSlug = office.organizationSlug
    await this.client.$transaction(
      async (tx) => {
        if (preset === 'none') {
          await this.clearMembers(tx, organizationSlug)
          await tx.outreach.deleteMany({
            where: { organizationSlug, name: CIVIC_PANEL_FIXTURE_SEND.name },
          })
          await tx.priority.deleteMany({
            where: {
              electedOfficeId: office.id,
              title: CIVIC_PANEL_FIXTURE_PRIORITY.title,
            },
          })
          await this.deletePanel(tx, organizationSlug)
          return
        }

        const goal = await this.ensurePanel(tx, organizationSlug, actorUserId)
        const members = membersFor(preset, goal)
        await this.clearMembers(tx, organizationSlug)
        await this.writeMembers(tx, organizationSlug, members)
        const ready = members >= goal
        await tx.managedCivicPanel.update({
          where: { organizationSlug },
          data: {
            status: ready
              ? ManagedCivicPanelStatus.ready
              : ManagedCivicPanelStatus.building,
            readyAt: ready ? new Date() : null,
            pausedAt: null,
            stoppedAt: null,
            confirmationDueAt: null,
          },
        })
        await this.writePriorityAsk(
          tx,
          office,
          answersFor(preset, members),
          members,
        )
      },
      { timeout: TX_TIMEOUT_MS },
    )
  }

  async current(
    office: ElectedOffice,
  ): Promise<TestModeCivicPanelPreset | null> {
    const organizationSlug = office.organizationSlug
    const panel = await this.model.findUnique({
      where: { organizationSlug },
      select: { goalMembers: true },
    })
    if (!panel) return 'none'

    const send = await this.client.outreach.findFirst({
      where: {
        organizationSlug,
        name: CIVIC_PANEL_FIXTURE_SEND.name,
        priority: {
          electedOfficeId: office.id,
          title: CIVIC_PANEL_FIXTURE_PRIORITY.title,
        },
      },
      select: { id: true },
    })
    if (send) {
      const replies = await this.client.pollIndividualMessage.count({
        where: {
          outreachId: send.id,
          sender: PollIndividualMessageSender.CONSTITUENT,
        },
      })
      if (replies === 0) return 'asked'
      return replies < answersNeeded() ? 'answers_coming' : 'answers_in'
    }

    // Exactly the members a preset wrote, so members added by hand never
    // shift it, and a small goal whose milestones coincide reads as the
    // higher one.
    const members = await this.client.contactStatusEvent.count({
      where: {
        organizationSlug,
        field: ContactStatusField.civic_panel,
        sourceId: { startsWith: FIXTURE_SOURCE_PREFIX },
      },
    })
    const goal = panel.goalMembers
    return (
      [...PANEL_PRESETS]
        .reverse()
        .find((preset) => members === membersFor(preset, goal)) ?? null
    )
  }

  // A panel the official approved stays, with its goal and invite; one
  // stopped is building again. Otherwise one is approved as if by them.
  private async ensurePanel(
    tx: Prisma.TransactionClient,
    organizationSlug: string,
    actorUserId: number,
  ): Promise<number> {
    const existing = await tx.managedCivicPanel.findUnique({
      where: { organizationSlug },
      select: { goalMembers: true },
    })
    if (existing) return existing.goalMembers
    const created = await tx.managedCivicPanel.create({
      data: {
        organizationSlug,
        inviteMessage: CIVIC_PANEL_FIXTURE_INVITE,
        consentVersion: MANAGED_CIVIC_PANEL_CONSENT_VERSION,
        approvedAt: new Date(),
        approvedByUserId: actorUserId,
        goalMembers: panelGoalMembers(answersNeeded()),
      },
      select: { goalMembers: true },
    })
    return created.goalMembers
  }

  private async deletePanel(
    tx: Prisma.TransactionClient,
    organizationSlug: string,
  ) {
    const sent = await tx.managedPanelWave.count({
      where: { enrollment: { organizationSlug } },
    })
    if (sent > 0) {
      throw new ConflictException(
        'This test civic panel has invite waves. Delete the organization instead.',
      )
    }
    await tx.managedCivicPanel.deleteMany({ where: { organizationSlug } })
  }

  private async clearMembers(
    tx: Prisma.TransactionClient,
    organizationSlug: string,
  ) {
    const joins = await tx.contactStatusEvent.findMany({
      where: {
        organizationSlug,
        field: ContactStatusField.civic_panel,
        sourceId: { startsWith: FIXTURE_SOURCE_PREFIX },
      },
      select: { personId: true },
    })
    const personIds = joins.map(({ personId }) => personId)
    await tx.contactCurrentStatus.deleteMany({
      where: {
        organizationSlug,
        field: ContactStatusField.civic_panel,
        personId: { in: personIds },
      },
    })
    await tx.contactStatusEvent.deleteMany({
      where: {
        organizationSlug,
        field: ContactStatusField.civic_panel,
        personId: { in: personIds },
      },
    })
  }

  private async writeMembers(
    tx: Prisma.TransactionClient,
    organizationSlug: string,
    members: number,
  ) {
    if (members === 0) return
    const now = new Date()
    const people = Array.from({ length: members }, (_, index) => ({
      personId: fixturePersonId(organizationSlug, index),
      joinedAt: subMinutes(
        now,
        Math.floor(((members - index) / members) * JOINED_OVER_DAYS * 1440),
      ),
    }))
    await tx.contactStatusEvent.createMany({
      data: people.map(({ personId, joinedAt }) => ({
        organizationSlug,
        personId,
        field: ContactStatusField.civic_panel,
        fromValue: CivicPanelStatus.left,
        toValue: CivicPanelStatus.member,
        source: ContactStatusSource.sms,
        sourceId: `${FIXTURE_SOURCE_PREFIX}${personId}`,
        createdAt: joinedAt,
      })),
    })
    await tx.contactCurrentStatus.createMany({
      data: people.map(({ personId }) => ({
        organizationSlug,
        personId,
        field: ContactStatusField.civic_panel,
        value: CivicPanelStatus.member,
      })),
    })
  }

  // The shared priority, kept across presets so its page stays open while
  // its answers change. `answers` null leaves it unasked.
  private async writePriorityAsk(
    tx: Prisma.TransactionClient,
    office: ElectedOffice,
    answers: number | null,
    members: number,
  ) {
    const organizationSlug = office.organizationSlug
    const priority =
      (await tx.priority.findFirst({
        where: {
          electedOfficeId: office.id,
          title: CIVIC_PANEL_FIXTURE_PRIORITY.title,
          archivedAt: null,
        },
        select: { id: true },
      })) ??
      (await tx.priority.create({
        data: {
          electedOfficeId: office.id,
          ...CIVIC_PANEL_FIXTURE_PRIORITY,
          source: PrioritySource.user_stated,
        },
        select: { id: true },
      }))

    await tx.outreach.deleteMany({
      where: {
        organizationSlug,
        priorityId: priority.id,
        name: CIVIC_PANEL_FIXTURE_SEND.name,
      },
    })
    await tx.feedbackSynthesisRun.deleteMany({
      where: { organizationSlug, priorityId: priority.id },
    })
    await tx.priorityRead.deleteMany({ where: { priorityId: priority.id } })
    if (answers === null) return

    const askedAt = subDays(new Date(), ASKED_DAYS_AGO)
    const recipients = Array.from({ length: members }, (_, index) => ({
      personId: fixturePersonId(organizationSlug, index),
      phone: fixturePhone(index),
    }))
    const outreach = await tx.outreach.create({
      data: {
        organizationSlug,
        campaignId: null,
        outreachType: OutreachType.text,
        status: OutreachStatus.completed,
        name: CIVIC_PANEL_FIXTURE_SEND.name,
        message: CIVIC_PANEL_FIXTURE_SEND.message,
        date: askedAt,
        textCount: recipients.length,
        priorityId: priority.id,
      },
      select: { id: true },
    })
    await tx.outreachTextRecipient.createMany({
      data: recipients.map(({ personId, phone }) => ({
        outreachId: outreach.id,
        organizationSlug,
        personId,
        phone,
      })),
    })

    const replies = recipients.slice(0, answers).map((recipient, index) => ({
      ...recipient,
      ...replyAt(index),
      id: randomUUID(),
      sentAt: addMinutes(askedAt, 15 + index * 7),
    }))
    const repliedAt = new Map(
      replies.map(({ personId, sentAt }) => [personId, sentAt]),
    )
    await tx.contactInteractionText.createMany({
      data: recipients.map(({ personId }) => ({
        organizationSlug,
        personId,
        occurredAt: askedAt,
        outreachId: outreach.id,
        respondedAt: repliedAt.get(personId) ?? null,
      })),
    })
    if (replies.length === 0) return

    await tx.pollIndividualMessage.createMany({
      data: replies.map(({ id, personId, phone, sentAt, content }) => ({
        id,
        outreachId: outreach.id,
        electedOfficeId: office.id,
        personId,
        personCellPhone: phone,
        sentAt,
        isOptOut: false,
        sender: PollIndividualMessageSender.CONSTITUENT,
        content,
      })),
    })
    await tx.priorityAnswer.createMany({
      data: replies.map(({ personId, code }) => ({
        organizationSlug,
        outreachId: outreach.id,
        personId,
        source: PriorityAnswerSource.text,
        sourceId: `${outreach.id}:${personId}`,
        code,
        model: FIXTURE_ENGINE,
        codedAt: new Date(),
      })),
    })

    // The results page shows themes only once the answers are enough.
    if (replies.length < answersNeeded()) return
    const run = await tx.feedbackSynthesisRun.create({
      data: {
        organizationSlug,
        scope: SynthesisScope.priority,
        priorityId: priority.id,
        status: SynthesisRunStatus.completed,
        completedAt: new Date(),
        conversations: replies.length,
        memos: replies.length,
        confirmed: replies.length,
        engine: FIXTURE_ENGINE,
      },
      select: { id: true },
    })
    for (const [rank, theme] of CIVIC_PANEL_FIXTURE_THEMES.entries()) {
      await tx.feedbackTheme.create({
        data: {
          runId: run.id,
          rank: rank + 1,
          title: theme.title,
          summary: theme.summary,
          details: theme.summary,
          members: {
            create: replies
              .filter(({ themeIndex }) => themeIndex === rank)
              .map(({ id }) => ({ textReplyId: id })),
          },
        },
      })
    }
  }
}

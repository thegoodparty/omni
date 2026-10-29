import { addDays } from 'date-fns'
import { PrismaClient } from '../../generated/prisma'
import {
  OutreachEmailRecipientStatus,
  OutreachHoldState,
  OutreachStatus,
  OutreachType,
} from '../../generated/prisma'

export const unique = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2)}`

export type EmailFixtureOrgs = {
  winSlug: string
  officeSlug: string
  campaignId: number
}

// A Pro campaign's organization and an office organization that came from
// it, both owned by the test user.
export const createEmailOrgs = async (
  prisma: PrismaClient,
  userId: number,
  { isPro = true }: { isPro?: boolean } = {},
): Promise<EmailFixtureOrgs> => {
  const suffix = unique()
  const winSlug = `campaign-${suffix}`
  const officeSlug = `eo-${suffix}`
  const campaignId = Math.floor(Math.random() * 1_000_000) + 1000
  await prisma.organization.create({ data: { slug: winSlug, ownerId: userId } })
  await prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: winSlug,
      userId,
      slug: `jane-${suffix}`,
      isPro,
      details: { state: 'TX', zip: '78634' },
      data: {},
      aiContent: {},
    },
  })
  await prisma.organization.create({
    data: { slug: officeSlug, ownerId: userId },
  })
  await prisma.electedOffice.create({
    data: { userId, organizationSlug: officeSlug, campaignId },
  })
  return { winSlug, officeSlug, campaignId }
}

export const createSender = (
  prisma: PrismaClient,
  organizationSlug: string,
  overrides: { warmingStep?: number; sesTenantName?: string | null } = {},
) =>
  prisma.outreachEmailSender.upsert({
    where: { organizationSlug },
    update: {},
    create: {
      organizationSlug,
      localPart: `jane.${unique()}`,
      displayName: 'Jane Doe',
      forwardToEmail: 'jane@example.com',
      warmingStep: overrides.warmingStep ?? 0,
      sesTenantName:
        overrides.sesTenantName === undefined
          ? `local-${organizationSlug}`
          : overrides.sesTenantName,
    },
  })

export const createSend = async (
  prisma: PrismaClient,
  {
    organizationSlug,
    campaignId,
    senderId,
    emails,
    status = OutreachStatus.draft,
    date = null,
    recipientCap = null,
    prepared = false,
    consent = true,
  }: {
    organizationSlug: string
    campaignId: number | null
    senderId: number
    emails: string[]
    status?: OutreachStatus
    date?: Date | null
    recipientCap?: number | null
    prepared?: boolean
    consent?: boolean
  },
) => {
  const outreach = await prisma.outreach.create({
    data: {
      outreachType: OutreachType.email,
      status,
      campaignId,
      organizationSlug,
      name: 'Town hall',
      date,
      email: {
        create: {
          senderId,
          goal: 'Invite neighbors',
          layout: 'newsletter',
          theme: 'classic_blue',
          subject: 'Town hall on Thursday',
          body: 'Join us at 7pm.',
          recipientCap,
          consentConfirmedAt: consent ? new Date() : null,
          ...(prepared
            ? { preparedAt: new Date(), sesTemplateName: 'local-email-test' }
            : {}),
        },
      },
    },
    include: { email: true },
  })
  const email = outreach.email
  if (!email) throw new Error('fixture send has no email row')
  await prisma.outreachEmailRecipient.createMany({
    data: emails.map((address, index) => ({
      outreachEmailId: email.id,
      senderId,
      email: address,
      firstName: `Person${index}`,
    })),
  })
  return { outreachId: outreach.id, outreachEmailId: email.id }
}

export const createHold = (
  prisma: PrismaClient,
  outreachId: number,
  state: OutreachHoldState,
) =>
  prisma.outreachPaymentHold.create({
    data: {
      outreachId,
      channel: OutreachType.email,
      state,
      stripeCustomerId: 'cus_test',
      paymentMethodId: 'pm_test',
      paymentIntentId: `pi_${unique()}`,
      estimateCents: 1000,
      authorizedCents: 1000,
      captureBefore: addDays(new Date(), 4),
    },
  })

export const recipientStatuses = async (
  prisma: PrismaClient,
  outreachEmailId: number,
) => {
  const rows = await prisma.outreachEmailRecipient.findMany({
    where: { outreachEmailId },
    orderBy: { id: 'asc' },
  })
  const counts: Partial<Record<OutreachEmailRecipientStatus, number>> = {}
  rows.forEach((row) => {
    counts[row.status] = (counts[row.status] ?? 0) + 1
  })
  return { rows, counts }
}

export const emails = (count: number, domain = 'example.com') =>
  Array.from({ length: count }, (_, i) => `person${i}@${domain}`)

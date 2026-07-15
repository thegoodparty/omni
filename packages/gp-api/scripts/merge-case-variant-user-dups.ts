/**
 * ENG-10682: merge the 11 case-variant duplicate user pairs.
 *
 * Each pair is one Clerk-linked survivor and one orphan (no clerk_id) created
 * by the pre-ENG-10672 case-sensitive email check. The orphan's campaigns,
 * organizations, and elected offices move to the survivor, Stripe/HubSpot ids
 * are copied where the survivor lacks them, the orphan row is deleted, and the
 * survivor's email is lowercased.
 *
 * Dry-run by default (reads only). Pass --execute to apply; all pairs run in
 * one transaction — any guard failure rolls back everything. Safe to run
 * twice: already-merged pairs are skipped (orphan gone + survivor verified).
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx scripts/merge-case-variant-user-dups.ts
 *   DATABASE_URL=postgres://... npx tsx scripts/merge-case-variant-user-dups.ts --execute
 */
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { Prisma, PrismaClient } from '../src/generated/prisma'

type PairSpec = {
  emailLower: string
  survivorId: number
  orphanId: number
}

// From the 2026-07-15 prod analysis (plan: ~/.claude/plans/86ajhv6tz-plan.md).
// Survivor = the Clerk-linked row; orphan has clerk_id NULL.
const PAIRS: PairSpec[] = [
  { emailLower: 'coachman2024@proton.me', survivorId: 11120, orphanId: 11141 },
  { emailLower: 'diana4azusa@gmail.com', survivorId: 8240, orphanId: 14729 },
  { emailLower: 'emmalcc1@icloud.com', survivorId: 28487, orphanId: 28961 },
  { emailLower: 'frank@frankgilbert.org', survivorId: 3246, orphanId: 4884 },
  {
    emailLower: 'gardinerforconstable@gmail.com',
    survivorId: 15547,
    orphanId: 18385,
  },
  {
    emailLower: 'info@rolanda4schoolboard.com',
    survivorId: 20628,
    orphanId: 21138,
  },
  {
    emailLower: 'peytensmommy2018@gmail.com',
    survivorId: 12777,
    orphanId: 13100,
  },
  {
    emailLower: 'rmwrosewilliams@gmail.com',
    survivorId: 16266,
    orphanId: 16433,
  },
  {
    emailLower: 'tamaraforelpaso@gmail.com',
    survivorId: 18740,
    orphanId: 26178,
  },
  {
    emailLower: 'tashuanyrodriguez10@gmail.com',
    survivorId: 17252,
    orphanId: 17261,
  },
  {
    emailLower: 'thomas@krouseforcarlsbad.com',
    survivorId: 20405,
    orphanId: 27156,
  },
]

// Dev is an older prod clone whose Clerk bindings landed on the opposite row
// in 8 of the 11 pairs (dev sign-ins bound whichever row the insensitive
// email lookup hit). The survivor must be the env's Clerk-linked row, so dev
// gets its own spec. Verified against gp-api-db (dev) 2026-07-15.
const DEV_PAIRS: PairSpec[] = [
  { emailLower: 'coachman2024@proton.me', survivorId: 11120, orphanId: 11141 },
  { emailLower: 'diana4azusa@gmail.com', survivorId: 14729, orphanId: 8240 },
  { emailLower: 'emmalcc1@icloud.com', survivorId: 28961, orphanId: 28487 },
  { emailLower: 'frank@frankgilbert.org', survivorId: 4884, orphanId: 3246 },
  {
    emailLower: 'gardinerforconstable@gmail.com',
    survivorId: 18385,
    orphanId: 15547,
  },
  {
    emailLower: 'info@rolanda4schoolboard.com',
    survivorId: 20628,
    orphanId: 21138,
  },
  {
    emailLower: 'peytensmommy2018@gmail.com',
    survivorId: 13100,
    orphanId: 12777,
  },
  {
    emailLower: 'rmwrosewilliams@gmail.com',
    survivorId: 16266,
    orphanId: 16433,
  },
  {
    emailLower: 'tamaraforelpaso@gmail.com',
    survivorId: 26178,
    orphanId: 18740,
  },
  {
    emailLower: 'tashuanyrodriguez10@gmail.com',
    survivorId: 17261,
    orphanId: 17252,
  },
  {
    emailLower: 'thomas@krouseforcarlsbad.com',
    survivorId: 27156,
    orphanId: 20405,
  },
]

// D3/D4 sign-off 2026-07-15: Emma's Taylor Swift demo campaign and the
// admin-repro thomas-krouse2 get deactivated as part of the merge.
// (325803 does not exist in dev; updateMany matches zero rows there.)
const CAMPAIGN_IDS_TO_DEACTIVATE = [21953, 325803]

const execute = process.argv.includes('--execute')
const useDevPairs = process.argv.includes('--pairs=dev')
const activePairs = useDevPairs ? DEV_PAIRS : PAIRS
const prisma = new PrismaClient()

type Tx = Prisma.TransactionClient

const assertOrphanHasNoUnexpectedContent = async (tx: Tx, orphanId: number) => {
  const [chats, annotations, conversations, uploads] = await Promise.all([
    tx.aiChat.count({ where: { userId: orphanId } }),
    tx.annotation.count({ where: { authorUserId: orphanId } }),
    tx.chatConversation.count({ where: { ownerUserId: orphanId } }),
    tx.userAgendaUpload.count({ where: { uploadedByUserId: orphanId } }),
  ])
  const total = chats + annotations + conversations + uploads
  if (total > 0) {
    throw new Error(
      `orphan ${orphanId} has ${total} dependent rows in ` +
        'ai_chat/annotation/chat_conversation/user_agenda_upload — ' +
        're-analyze before merging',
    )
  }
}

type UserMeta = NonNullable<PrismaJson.UserMetaData>

const metaDataKeysToCopy = (survivorMeta: UserMeta, orphanMeta: UserMeta) => {
  const copied: Partial<Pick<UserMeta, 'customerId' | 'hubspotId'>> = {}
  if (!survivorMeta.customerId && orphanMeta.customerId) {
    copied.customerId = orphanMeta.customerId
  }
  if (!survivorMeta.hubspotId && orphanMeta.hubspotId) {
    copied.hubspotId = orphanMeta.hubspotId
  }
  return copied
}

const mergePair = async (tx: Tx, pair: PairSpec) => {
  const survivor = await tx.user.findUnique({ where: { id: pair.survivorId } })
  const orphan = await tx.user.findUnique({ where: { id: pair.orphanId } })

  if (!survivor) {
    throw new Error(`survivor ${pair.survivorId} not found`)
  }
  if (survivor.email.toLowerCase().trim() !== pair.emailLower) {
    throw new Error(
      `survivor ${pair.survivorId} email ${survivor.email} != ${pair.emailLower}`,
    )
  }
  if (!survivor.clerkId) {
    throw new Error(`survivor ${pair.survivorId} has no clerk_id`)
  }
  if (!orphan) {
    console.log(
      `pair ${pair.emailLower}: orphan ${pair.orphanId} already gone — skipping`,
    )
    return
  }
  if (orphan.clerkId) {
    throw new Error(`orphan ${pair.orphanId} has a clerk_id — not an orphan`)
  }
  if (orphan.email.toLowerCase().trim() !== pair.emailLower) {
    throw new Error(
      `orphan ${pair.orphanId} email ${orphan.email} != ${pair.emailLower}`,
    )
  }

  await assertOrphanHasNoUnexpectedContent(tx, pair.orphanId)

  const campaigns = await tx.campaign.updateMany({
    where: { userId: pair.orphanId },
    data: { userId: pair.survivorId },
  })
  const organizations = await tx.organization.updateMany({
    where: { ownerId: pair.orphanId },
    data: { ownerId: pair.survivorId },
  })
  const electedOffices = await tx.electedOffice.updateMany({
    where: { userId: pair.orphanId },
    data: { userId: pair.survivorId },
  })
  // A collision on artifact_feedback's (submitter, briefing, artifact) unique
  // key aborts the whole transaction — the fail-safe outcome.
  const feedback = await tx.artifactFeedback.updateMany({
    where: { submitterUserId: pair.orphanId },
    data: { submitterUserId: pair.survivorId },
  })
  const history = await tx.campaignUpdateHistory.updateMany({
    where: { userId: pair.orphanId },
    data: { userId: pair.survivorId },
  })

  const survivorMeta = survivor.metaData ?? {}
  const copied = metaDataKeysToCopy(survivorMeta, orphan.metaData ?? {})

  await tx.user.delete({ where: { id: pair.orphanId } })

  await tx.user.update({
    where: { id: pair.survivorId },
    data: {
      email: pair.emailLower,
      ...(Object.keys(copied).length
        ? { metaData: { ...survivorMeta, ...copied } }
        : {}),
    },
  })

  console.log(
    `pair ${pair.emailLower}: moved ${campaigns.count} campaigns, ` +
      `${organizations.count} orgs, ${electedOffices.count} elected offices, ` +
      `${feedback.count} feedback rows, ${history.count} history rows ` +
      `from ${pair.orphanId} to ${pair.survivorId}; copied meta keys: ` +
      `${Object.keys(copied).join(',') || 'none'}; orphan deleted`,
  )
}

const dryRunReport = async () => {
  for (const pair of activePairs) {
    const [survivor, orphan, campaigns, organizations, electedOffices] =
      await Promise.all([
        prisma.user.findUnique({ where: { id: pair.survivorId } }),
        prisma.user.findUnique({ where: { id: pair.orphanId } }),
        prisma.campaign.findMany({
          where: { userId: pair.orphanId },
          select: { id: true, slug: true, isActive: true },
        }),
        prisma.organization.count({ where: { ownerId: pair.orphanId } }),
        prisma.electedOffice.count({ where: { userId: pair.orphanId } }),
      ])
    if (!orphan) {
      console.log(`${pair.emailLower}: orphan gone — already merged`)
      continue
    }
    const copied = metaDataKeysToCopy(
      survivor?.metaData ?? {},
      orphan.metaData ?? {},
    )
    console.log(
      `${pair.emailLower}: would move ` +
        `${campaigns.map((c) => `${c.id}(${c.slug})`).join('+') || 'no'} ` +
        `campaigns, ${organizations} orgs, ${electedOffices} elected offices ` +
        `from ${pair.orphanId} to ${pair.survivorId}; copy meta: ` +
        `${Object.keys(copied).join(',') || 'none'}`,
    )
  }
  const toDeactivate = await prisma.campaign.findMany({
    where: { id: { in: CAMPAIGN_IDS_TO_DEACTIVATE } },
    select: { id: true, slug: true, isActive: true },
  })
  console.log(
    `would deactivate: ${toDeactivate
      .map((c) => `${c.id}(${c.slug}, active=${c.isActive})`)
      .join(', ')}`,
  )
}

const verifyNoDuplicatesRemain = async (tx: Tx) => {
  const remaining = await tx.$queryRaw<{ email: string; n: bigint }[]>`
    SELECT LOWER(email) AS email, COUNT(*) AS n
    FROM "user" GROUP BY LOWER(email) HAVING COUNT(*) > 1
  `
  if (remaining.length > 0) {
    throw new Error(
      `duplicates remain after merge: ${remaining
        .map((r) => r.email)
        .join(', ')} — rolling back`,
    )
  }
}

// Full row capture for the audit trail: the orphan rows (including divergent
// hubspotIds that CS needs for the HubSpot-side contact merge) exist nowhere
// else once deleted.
const captureState = async (label: 'before' | 'after') => {
  const userIds = activePairs.flatMap((p) => [p.survivorId, p.orphanId])
  const [users, campaigns, organizations, electedOffices] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      omit: { password: true, passwordResetToken: true },
    }),
    prisma.campaign.findMany({
      where: { userId: { in: userIds } },
      select: { id: true, slug: true, userId: true, isActive: true },
    }),
    prisma.organization.findMany({ where: { ownerId: { in: userIds } } }),
    prisma.electedOffice.findMany({
      where: { userId: { in: userIds } },
      select: { id: true, userId: true },
    }),
  ])
  return { label, users, campaigns, organizations, electedOffices }
}

const writeAuditFile = (name: string, state: object) => {
  const outputDir = join(__dirname, 'output')
  mkdirSync(outputDir, { recursive: true })
  const path = join(outputDir, `merge-case-variant-user-dups-${name}.json`)
  writeFileSync(path, JSON.stringify(state, null, 2))
  console.log(`audit trail written to ${path}`)
}

const main = async () => {
  if (!execute) {
    console.log('DRY RUN (pass --execute to apply)\n')
    await dryRunReport()
    return
  }

  // Written to disk BEFORE any write: the orphan rows are unrecoverable after
  // the transaction commits.
  const stamp = Date.now()
  writeAuditFile(`${stamp}-before`, await captureState('before'))

  await prisma.$transaction(
    async (tx) => {
      for (const pair of activePairs) {
        await mergePair(tx, pair)
      }
      const deactivated = await tx.campaign.updateMany({
        where: { id: { in: CAMPAIGN_IDS_TO_DEACTIVATE }, isActive: true },
        data: { isActive: false },
      })
      console.log(`deactivated ${deactivated.count} junk campaigns`)
      await verifyNoDuplicatesRemain(tx)
    },
    { timeout: 120_000 },
  )

  writeAuditFile(`${stamp}-after`, await captureState('after'))
  console.log('all pairs merged; zero case-insensitive duplicates remain')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

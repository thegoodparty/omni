import { PrismaClient } from '../src/generated/prisma'
import { parseArgs } from 'util'

// factory seeds
import seedCampaigns from './campaigns'
import seedTopIssues from './topIssues'
import seedUsers, { SERVE_USER } from './users'
import seedWebsiteData from './websiteData'
// csv file seeds
import seedMtfcc from './mtfcc'
import seedOffices from './offices'
import { resyncSeededSequences } from './util/resyncSequences.util'
import seedContentful from './contentful'

const SKIP_MTFCC_SEED = ['true', '1', 'yes'].includes(
  process.env.SKIP_MTFCC_SEED?.toLowerCase() || '',
)

const LIMIT_SEEDS =
  process.env.NODE_ENV === 'production' ||
  process.env.NODE_ENV === 'development'
const RUN_FACTORY_SEEDS_IN_DEV =
  process.env.NODE_ENV === 'development' && SKIP_MTFCC_SEED

const prisma = new PrismaClient()

async function main() {
  if (LIMIT_SEEDS && !RUN_FACTORY_SEEDS_IN_DEV) {
    // only want to run seeds from CSV files in prod or dev
    await csvSeeds(prisma)
  } else {
    const seedType = getTypeArg()

    if (seedType === 'csv' || seedType === 'all') {
      await csvSeeds(prisma)

      // if only running csv file seeds, return early
      if (seedType === 'csv') return
    }

    // run factory seeds
    const users = await seedUsers(prisma)
    const campaignIds = await seedCampaigns(prisma, users)
    await seedTopIssues(prisma, campaignIds)
    await seedWebsiteData(prisma)
    await seedOffices(SERVE_USER.email, prisma)
    await seedContentful(prisma)

    // The factory seeds above insert campaign plan versions, campaign
    // positions and campaign update history with explicit random ids, which
    // leaves those sequences untouched and every later insert colliding. Must
    // run after the factory seeds and only on this branch — the csv-only
    // branch writes no explicit ids.
    await resyncSeededSequences(prisma)
  }
}

async function csvSeeds(prisma: PrismaClient) {
  if (SKIP_MTFCC_SEED) {
    console.log('Skipping MTFCC seed (SKIP_MTFCC_SEED=true)')
    return
  }
  await seedMtfcc(prisma)
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })

function getTypeArg() {
  const { values } = parseArgs({
    options: {
      type: { type: 'string', short: 't' },
    },
  })
  return values.type
}

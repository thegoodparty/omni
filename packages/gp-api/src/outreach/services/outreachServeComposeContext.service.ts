import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { Prisma } from '../../generated/prisma'

// Mirrors OutreachComposeContextService's trim discipline — prompts target
// short outputs, so every block is trimmed rather than passed whole.
const TEXT_MAX_CHARS = 2000
const LIST_ITEM_MAX = 5
const LIST_ITEM_MAX_CHARS = 300
const PRIORITIES_MAX = 10

const trim = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`

// Assembles the elected official's own Public Profile materials (bio, why
// they serve, accomplishments, recent experience, published priorities)
// into prompt context blocks for the Serve compose AI. The labels below are
// agreed with product/politics (ENG-10982) and are load-bearing — their
// prompt copy references them verbatim, so changing one is a product
// decision, not a refactor. Every block is optional: a profile-less
// official (or one with all-null fields) gets an empty array and the
// prompts fall back to the name/office/place baseline, byte-identical to
// today.
@Injectable()
export class OutreachServeComposeContextService extends createPrismaBase(
  MODELS.PersonProfile,
) {
  async buildProfileContext(userId: number): Promise<string[]> {
    // No publishedAt gate here on purpose: the public page's live/gone
    // state is a render concern, but the official's own words are theirs
    // to ground prompts on whether or not the public page is live.
    const profile = await this.model.findUnique({
      where: { userId },
      include: {
        issues: {
          where: { visible: true },
          orderBy: { sortOrder: Prisma.SortOrder.asc },
          include: { priority: true },
        },
      },
    })

    if (!profile) {
      return []
    }

    const blocks: string[] = []

    const bio = profile.bioOverride?.trim()
    if (bio) {
      blocks.push(
        [
          "The official's bio, in their own words:",
          '"""',
          trim(bio, TEXT_MAX_CHARS),
          '"""',
        ].join('\n'),
      )
    }

    const whyRunning = profile.whyRunning?.trim()
    if (whyRunning) {
      blocks.push(
        [
          'Why they serve, in their own words:',
          '"""',
          trim(whyRunning, TEXT_MAX_CHARS),
          '"""',
        ].join('\n'),
      )
    }

    // JSONB overlay columns are not schema-validated at write time — render
    // off the typed shape but skip an entry missing its required title
    // rather than throwing.
    const accomplishments = (profile.accomplishments ?? [])
      .filter((item) => item && typeof item.title === 'string' && item.title)
      .slice(0, LIST_ITEM_MAX)
    if (accomplishments.length > 0) {
      blocks.push(
        [
          "The official's accomplishments:",
          ...accomplishments.map((item) => {
            const description = item.description?.trim()
            return description
              ? `- ${item.title}: ${trim(description, LIST_ITEM_MAX_CHARS)}`
              : `- ${item.title}`
          }),
        ].join('\n'),
      )
    }

    const recentExperience = (profile.recentExperience ?? [])
      .filter((item) => item && typeof item.title === 'string' && item.title)
      .slice(0, LIST_ITEM_MAX)
    if (recentExperience.length > 0) {
      blocks.push(
        [
          "The official's recent experience:",
          ...recentExperience.map((item) => {
            const org = item.organization?.trim()
            return org
              ? `- ${item.title}, ${trim(org, LIST_ITEM_MAX_CHARS)}`
              : `- ${item.title}`
          }),
        ].join('\n'),
      )
    }

    const priorities = profile.issues.slice(0, PRIORITIES_MAX)
    if (priorities.length > 0) {
      blocks.push(
        [
          "The official's published priorities:",
          ...priorities.map(({ priority }) => {
            const description = trim(priority.description, LIST_ITEM_MAX_CHARS)
            return `- ${priority.title}: ${description}`
          }),
        ].join('\n'),
      )
    }

    return blocks
  }
}

import { Injectable, NotFoundException, StreamableFile } from '@nestjs/common'
import type {
  PriorityThemeComment,
  PriorityThemeComments,
} from '@goodparty_org/contracts'
import {
  ElectedOffice,
  Prisma,
  SynthesisRunStatus,
  SynthesisScope,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { csvCell } from '@/constituentFeedback/services/feedbackNotesExport.service'

const UTF8_BOM = '﻿'

// The members the results page counts (pooledThemes in
// priorityResults.service.ts): confirmed notes and text replies, here less
// a reply that only opted out, as the polls download leaves those out. Only
// the words and when they came in are read, never who said them.
const MEMBERS = {
  where: {
    OR: [
      { feedback: { confirmedAt: { not: null } } },
      {
        textReply: {
          OR: [{ isOptOut: false }, { isOptOut: null }],
        },
      },
    ],
  },
  select: {
    feedback: { select: { id: true, transcript: true, occurredAt: true } },
    textReply: { select: { id: true, content: true, sentAt: true } },
  },
} as const satisfies Prisma.FeedbackTheme$membersArgs

type Member = Prisma.FeedbackThemeMemberGetPayload<{
  select: typeof MEMBERS.select
}>

interface Comment extends PriorityThemeComment {
  key: string
  at: Date
}

const commentOf = (member: Member): Comment | null => {
  if (member.textReply) {
    const text = member.textReply.content?.trim()
    return text
      ? {
          key: `reply:${member.textReply.id}`,
          text,
          kind: 'reply',
          at: member.textReply.sentAt,
        }
      : null
  }
  const text = member.feedback?.transcript?.trim()
  return member.feedback && text
    ? {
        key: `note:${member.feedback.id}`,
        text,
        kind: 'note',
        at: member.feedback.occurredAt,
      }
    : null
}

const oldestFirst = (a: Comment, b: Comment): number =>
  a.at.getTime() - b.at.getTime()

const fileNameOf = (...parts: string[]): string =>
  parts
    .map((part) => part.replace(/[^a-zA-Z0-9 _-]/g, '').trim())
    .filter((part) => part !== '')
    .join(' - ') || 'comments'

@Injectable()
export class PriorityThemeCommentsService extends createPrismaBase(
  MODELS.Priority,
) {
  // One theme's comments, words only. The theme must come from one of this
  // org's pooled runs on this priority, so a theme id from another org or
  // another priority 404s like a missing one.
  async commentsFor(
    electedOffice: ElectedOffice,
    priorityId: string,
    themeId: string,
  ): Promise<PriorityThemeComments> {
    await this.assertOwned(electedOffice, priorityId)
    const theme = await this.findTheme(electedOffice, priorityId, themeId)
    return {
      themeId: theme.id,
      comments: theme.members
        .flatMap((member) => commentOf(member) ?? [])
        .sort(oldestFirst)
        .map(({ text, kind }) => ({ text, kind })),
    }
  }

  // A CSV of comment and theme, nothing else. With a theme, that theme's
  // comments; without one, every comment in the latest pooled run, the run
  // the page shows, each once with all its themes joined.
  async commentsCsv(
    electedOffice: ElectedOffice,
    priorityId: string,
    themeId?: string,
  ): Promise<StreamableFile> {
    const priority = await this.assertOwned(electedOffice, priorityId)
    const themes = themeId
      ? [await this.findTheme(electedOffice, priorityId, themeId)]
      : await this.latestThemes(electedOffice, priorityId)

    const rows = new Map<string, { comment: Comment; themes: string[] }>()
    for (const theme of themes) {
      for (const member of theme.members) {
        const comment = commentOf(member)
        if (!comment) continue
        const row = rows.get(comment.key) ?? { comment, themes: [] }
        row.themes.push(theme.title)
        rows.set(comment.key, row)
      }
    }
    const lines = [
      ['Comment', 'Theme'],
      ...[...rows.values()]
        .sort((a, b) => oldestFirst(a.comment, b.comment))
        .map(({ comment, themes: titles }) => [
          comment.text,
          titles.join('; '),
        ]),
    ]
    const csv =
      lines.map((line) => line.map(csvCell).join(',')).join('\r\n') + '\r\n'
    const body = Buffer.from(UTF8_BOM + csv, 'utf-8')
    const name = fileNameOf(priority.title, themeId ? themes[0]!.title : '')
    return new StreamableFile(body, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${name} comments.csv"`,
      length: body.length,
    })
  }

  private async findTheme(
    electedOffice: ElectedOffice,
    priorityId: string,
    themeId: string,
  ) {
    const theme = await this.client.feedbackTheme.findFirst({
      where: {
        id: themeId,
        run: {
          organizationSlug: electedOffice.organizationSlug,
          priorityId,
          scope: SynthesisScope.priority,
        },
      },
      select: { id: true, title: true, members: MEMBERS },
    })
    if (!theme) throw new NotFoundException('Theme not found')
    return theme
  }

  private async latestThemes(electedOffice: ElectedOffice, priorityId: string) {
    const run = await this.client.feedbackSynthesisRun.findFirst({
      where: {
        organizationSlug: electedOffice.organizationSlug,
        priorityId,
        scope: SynthesisScope.priority,
        status: SynthesisRunStatus.completed,
      },
      orderBy: { completedAt: Prisma.SortOrder.desc },
      select: {
        themes: {
          orderBy: { rank: Prisma.SortOrder.asc },
          select: { id: true, title: true, members: MEMBERS },
        },
      },
    })
    return run?.themes ?? []
  }

  private async assertOwned(electedOffice: ElectedOffice, priorityId: string) {
    const priority = await this.model.findFirst({
      where: { id: priorityId, electedOfficeId: electedOffice.id },
      select: { id: true, title: true },
    })
    if (!priority) throw new NotFoundException('Priority not found')
    return priority
  }
}

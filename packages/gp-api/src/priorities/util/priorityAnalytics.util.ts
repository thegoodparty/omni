import type { AnalyticsService } from '@/analytics/analytics.service'
import type { Prisma, PrismaClient } from 'src/generated/prisma'
import type { SegmentTrackEventProperties } from 'src/vendors/segment/segment.types'

export type PrioritySurface = 'priorities_page' | 'chief_of_staff'

// A priority belongs to an office, not a user, so every event goes to the
// office's user. Never throws: telemetry must not fail the write it follows.
export const trackForOffice = async (
  client: PrismaClient,
  analytics: AnalyticsService,
  office: Prisma.ElectedOfficeWhereInput,
  events: [string, SegmentTrackEventProperties][],
): Promise<void> => {
  if (events.length === 0) return
  try {
    const row = await client.electedOffice.findFirst({
      where: office,
      select: { userId: true, organizationSlug: true },
    })
    if (!row) return
    for (const [event, properties] of events) {
      void analytics
        .track(row.userId, event, {
          organizationSlug: row.organizationSlug,
          ...properties,
        })
        .catch(() => undefined)
    }
  } catch {
    return
  }
}

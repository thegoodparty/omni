import { NotFoundException } from '@nestjs/common'
import type { PrismaClient } from '../../generated/prisma'

// A priority belongs to one elected office, so the caller's own office is the
// whole tenancy boundary: a request body must not be able to hang outreach
// off someone else's priority.
export const assertPriorityInOffice = async (
  client: Pick<PrismaClient, 'priority'>,
  priorityId: string,
  electedOfficeId: string,
): Promise<void> => {
  const priority = await client.priority.findFirst({
    where: { id: priorityId, electedOfficeId, archivedAt: null },
    select: { id: true },
  })
  if (!priority) throw new NotFoundException('Priority not found')
}

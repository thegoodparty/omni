import { Injectable } from '@nestjs/common'
import {
  RoutePayloadTargetNotes,
  ROUTE_TARGET_NOTE_LIMIT,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { Prisma } from '../../generated/prisma'

type NoteRow = {
  personId: string
  id: string
  body: string
  createdAt: Date
  updatedAt: Date
  total: number
}

// Its own reader rather than a method on `ContactNoteService`, which is the
// CRM's per-person CRUD and reads one person's notes unbounded. The door needs
// many people at once, capped, with a count — different enough that sharing
// one method would mean a `limit`/`personIds` shaped hole in the CRUD service
// for a caller it otherwise knows nothing about. Same split as
// `DoorKnockingStatusService` and `DoorKnockingActivityService`, which read CRM
// tables the door's way without reshaping the CRM's own services.
@Injectable()
export class DoorKnockingNotesService extends createPrismaBase(
  MODELS.ContactNote,
) {
  // ADR 0011. Every target's notes for one route, in one query.
  //
  // One statement for the whole route rather than one per resident: the route
  // serve runs on every walk open and every map open, and a 150-stop route
  // would otherwise fire ~150 round trips behind a single GET.
  //
  // The cap is applied in SQL by the same `ROW_NUMBER()` window ADR 0009 uses
  // for the activity feed, for the same reason — an org that has been taking
  // notes on these people all cycle should not have all of them read into Node
  // heap so three can be kept.
  //
  // `COUNT(*) OVER` rides the identical partition, so the resident's true note
  // count comes back on the rows the window already produced. That is what
  // makes truncation legible at the door without a second aggregate query, and
  // it is why the count is exact rather than "3+".
  //
  // Served by contact_note's (organization_slug, person_id, created_at) index.
  async notesByPersonId(
    organizationSlug: string,
    personIds: string[],
  ): Promise<Map<string, RoutePayloadTargetNotes>> {
    if (personIds.length === 0) return new Map()

    // Newest first by when the note was written, never by when it was last
    // edited — the CRM's own `listForPerson` ordering. Sorting on updated_at
    // would jump a two-year-old note to the top of the door's list because
    // somebody fixed a typo in it.
    //
    // `id DESC` breaks same-instant ties, which `created_at` alone leaves to
    // Postgres. ContactNote ids are uuid(7) and therefore time-ordered, so this
    // agrees with created_at rather than cutting across it, and one resident's
    // notes cannot come back in one order at the door and another in Contacts.
    const rows = await this.client.$queryRaw<NoteRow[]>(Prisma.sql`
      SELECT ranked."personId", ranked.id, ranked.body,
             ranked."createdAt", ranked."updatedAt", ranked.total
      FROM (
        SELECT person_id AS "personId", id, body,
               created_at AS "createdAt", updated_at AS "updatedAt",
               COUNT(*) OVER (PARTITION BY person_id)::int AS total,
               ROW_NUMBER() OVER (
                 PARTITION BY person_id ORDER BY created_at DESC, id DESC
               ) AS rank
        FROM contact_note
        WHERE organization_slug = ${organizationSlug}
          AND person_id IN (${Prisma.join(personIds)})
      ) ranked
      WHERE ranked.rank <= ${ROUTE_TARGET_NOTE_LIMIT}
      ORDER BY ranked."personId", ranked.rank
    `)

    const byPersonId = new Map<string, RoutePayloadTargetNotes>()
    for (const row of rows) {
      const group = byPersonId.get(row.personId) ?? {
        entries: [],
        total: row.total,
      }
      group.entries.push({
        id: row.id,
        personId: row.personId,
        body: row.body,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })
      byPersonId.set(row.personId, group)
    }
    return byPersonId
  }
}

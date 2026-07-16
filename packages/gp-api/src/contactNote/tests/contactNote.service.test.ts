import { isAfter } from 'date-fns'
import { describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import { ContactNoteService } from '../services/contactNote.service'

const service = useTestService()

const seedOrg = (slug: string) =>
  service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })

describe('ContactNoteService', () => {
  it('lists only the given org+person notes, newest first', async () => {
    await seedOrg('org-1')
    await seedOrg('org-2')
    const contactNotes = service.app.get(ContactNoteService)
    const older = await service.prisma.contactNote.create({
      data: {
        organizationSlug: 'org-1',
        personId: 'person-a',
        body: 'older',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    })
    const newer = await service.prisma.contactNote.create({
      data: {
        organizationSlug: 'org-1',
        personId: 'person-a',
        body: 'newer',
        createdAt: new Date('2026-02-01T00:00:00Z'),
      },
    })
    await contactNotes.create('org-2', 'person-a', 'other org')
    await contactNotes.create('org-1', 'person-b', 'other person')

    const notes = await contactNotes.listForPerson('org-1', 'person-a')

    expect(notes.map((note) => note.id)).toEqual([newer.id, older.id])
  })

  it('deletes nothing on org mismatch and deletes with the owning org', async () => {
    await seedOrg('org-1')
    await seedOrg('org-2')
    const contactNotes = service.app.get(ContactNoteService)
    const note = await contactNotes.create('org-1', 'person-a', 'keep me')

    const missCount = await contactNotes.deleteByIdAndOrganizationSlug(
      note.id,
      'org-2',
    )
    expect(missCount).toBe(0)
    expect(await contactNotes.count({ where: { id: note.id } })).toBe(1)

    const hitCount = await contactNotes.deleteByIdAndOrganizationSlug(
      note.id,
      'org-1',
    )
    expect(hitCount).toBe(1)
    expect(await contactNotes.count({ where: { id: note.id } })).toBe(0)
  })

  it('update round-trips body, bumps updatedAt, and misses cross-org', async () => {
    await seedOrg('org-1')
    await seedOrg('org-2')
    const contactNotes = service.app.get(ContactNoteService)
    const note = await service.prisma.contactNote.create({
      data: {
        organizationSlug: 'org-1',
        personId: 'person-a',
        body: 'original',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    })

    const miss = await contactNotes.updateByIdAndOrganizationSlug(
      note.id,
      'org-2',
      'hijacked',
    )
    expect(miss).toBeNull()
    const afterMiss = await contactNotes.findFirstOrThrow({
      where: { id: note.id },
    })
    expect(afterMiss.body).toBe('original')

    const updated = await contactNotes.updateByIdAndOrganizationSlug(
      note.id,
      'org-1',
      'edited',
    )
    expect(updated?.body).toBe('edited')
    const persisted = await contactNotes.findFirstOrThrow({
      where: { id: note.id },
    })
    expect(persisted.body).toBe('edited')
    expect(isAfter(persisted.updatedAt, note.updatedAt)).toBe(true)
  })
})

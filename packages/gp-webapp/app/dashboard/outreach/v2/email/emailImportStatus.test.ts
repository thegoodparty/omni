import { describe, expect, it } from 'vitest'
import type { ContactUpload } from '@goodparty_org/contracts'
import { emailImportStatus } from './emailImportStatus'
import { SERVE_EMAIL_SURFACE, WIN_EMAIL_SURFACE } from './emailSurface'

const upload = (overrides: Partial<ContactUpload>): ContactUpload => ({
  id: 'mine',
  createdAt: '2026-11-10T12:00:00.000Z',
  name: 'Volunteer sign-up',
  fileName: 'volunteers.csv',
  uploadedBy: null,
  status: 'processing',
  columnMapping: {
    firstName: 'First',
    lastName: 'Last',
    email: null,
    cellPhone: null,
    landline: null,
    addressLine: null,
    city: null,
    zip: null,
  },
  rowCount: null,
  matchedCount: 0,
  newCount: 0,
  needsInputCount: 0,
  skippedCount: 0,
  invalidCount: 0,
  updatedCount: 0,
  unchangedCount: 0,
  completedAt: null,
  failureReason: null,
  failureKind: null,
  progress: null,
  ...overrides,
})

describe('emailImportStatus', () => {
  it('adds up every upload still processing, wherever it started', () => {
    expect(
      emailImportStatus(
        [
          upload({ progress: { added: 0, needsInput: 0 } }),
          upload({ id: 'other', progress: { added: 1, needsInput: 1 } }),
        ],
        'mine',
        WIN_EMAIL_SURFACE,
        false,
      ),
    ).toEqual({
      importing: true,
      line: 'Adding your contacts… 1 so far.',
      link: {
        text: '1 needs your review',
        href: '/dashboard/contacts/uploads/other',
      },
      after: "and isn't in this email yet.",
    })
    expect(
      emailImportStatus(
        [
          upload({ progress: { added: 0, needsInput: 2 } }),
          upload({ id: 'other', progress: { added: 1, needsInput: 1 } }),
        ],
        'mine',
        WIN_EMAIL_SURFACE,
        true,
      ),
    ).toMatchObject({
      link: {
        text: '3 need your review',
        href: '/dashboard/contacts/uploads',
      },
      after: "and aren't in this email yet. You can pay once they're added.",
    })
  })

  it('has no number before any row is settled', () => {
    expect(
      emailImportStatus(
        [upload({ progress: { added: 0, needsInput: 0 } })],
        null,
        SERVE_EMAIL_SURFACE,
        false,
      ).line,
    ).toBe('Adding your contacts…')
  })

  it("says only how this flow's import ended once nothing is processing", () => {
    expect(
      emailImportStatus(
        [
          upload({ status: 'complete', matchedCount: 1, newCount: 0 }),
          upload({ id: 'other', status: 'complete', newCount: 9 }),
        ],
        'mine',
        WIN_EMAIL_SURFACE,
        true,
      ),
    ).toEqual({
      importing: false,
      line: '1 contact added.',
      link: null,
      after: null,
    })
    expect(
      emailImportStatus(
        [
          upload({
            status: 'needs_input',
            newCount: 4,
            needsInputCount: 2,
          }),
        ],
        'mine',
        WIN_EMAIL_SURFACE,
        false,
      ),
    ).toMatchObject({
      line: '4 contacts added.',
      link: {
        text: '2 need your review',
        href: '/dashboard/contacts/uploads/mine',
      },
    })
    expect(
      emailImportStatus(
        [upload({ status: 'failed' })],
        'mine',
        WIN_EMAIL_SURFACE,
        false,
      ),
    ).toEqual({
      importing: false,
      line: "Your contacts didn't finish importing. Try again from your",
      link: {
        text: 'import history',
        href: '/dashboard/contacts/uploads/mine',
      },
      after: '.',
    })
    expect(
      emailImportStatus(
        [upload({ id: 'other', status: 'complete' })],
        'mine',
        WIN_EMAIL_SURFACE,
        false,
      ),
    ).toEqual({ importing: false, line: null, link: null, after: null })
  })
})

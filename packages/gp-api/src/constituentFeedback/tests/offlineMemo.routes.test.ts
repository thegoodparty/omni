import { randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest'
import {
  ConstituentFeedbackCaptureMethod,
  ConstituentFeedbackExtractionStatus,
  OrganizationRole,
} from '@/generated/prisma'
import { FeaturesService } from '@/features/services/features.service'
import { LlmService } from '@/llm/services/llm.service'
import { useTestService } from '@/test-service'
import { SEED_MEMOS } from '../services/feedbackSeedMemos'
import { PendingTranscriptionService } from '../services/pendingTranscription.service'
import {
  call,
  createWinOrg,
  knock,
  ownerHeaders,
  seedCallMemo,
  seedKnockMemo,
  seedPhoneEffort,
  seedTurfEffort,
  type StopTarget,
} from './issueCaptureFixtures'

// .env.test pins SPEECH_TRANSCRIBE_FILE_MODE=mock, so nothing here reaches S3
// or Transcribe: the upload URL points at gp-api's own sink, and a job
// "finishes" with a fixture sentence on the first poll three seconds on.
const service = useTestService()

const createVolunteer = async (slug: string) => {
  const label = `offline-volunteer-${randomUUID()}`
  const user = await service.prisma.user.create({
    data: { email: `${label}@example.com`, clerkId: `user_${label}` },
  })
  await service.prisma.organizationMembership.create({
    data: {
      organizationSlug: slug,
      userId: user.id,
      role: OrganizationRole.volunteer,
    },
  })
  const token = jwt.sign({ sub: `user_${label}` }, process.env.AUTH_SECRET!, {
    expiresIn: '1h',
  })
  return {
    user,
    config: {
      headers: {
        'x-organization-slug': slug,
        Authorization: `Bearer ${token}`,
      },
      validateStatus: () => true,
    },
  }
}

const assign = (slug: string, outreachId: number, assigneeUserId: number) =>
  service.prisma.outreachAssignment.create({
    data: { organizationSlug: slug, outreachId, assigneeUserId },
  })

// Distinct cron slots far from the wall clock, so the scheduler's own
// per-minute firing never holds the claim a test pass needs.
const FIRST_SLOT = new Date('2026-01-01T00:00:00.000Z')
const NEXT_SLOT = new Date('2026-01-01T00:01:00.000Z')

describe('offline memo capture', () => {
  let slug: string
  let outreachId: number
  let targets: StopTarget[]
  let completion: { mockRestore: () => void }

  beforeEach(async () => {
    ;({ slug } = await createWinOrg(service))
    ;({ outreachId, targets } = await seedTurfEffort(service, slug, {
      question: 'What should the town fix first?',
      people: 3,
    }))
    completion = vi
      .spyOn(service.app.get(LlmService), 'jsonCompletion')
      .mockResolvedValue({
        object: {
          issueLabel: 'Street flooding',
          stance: 'opposes',
          desiredOutcome: 'Clear the storm drain',
          confidence: 0.9,
        },
        tokens: 1,
        inputTokens: 1,
        outputTokens: 1,
        model: 'claude-test',
      })
  })

  // Restored one by one: restoreAllMocks would also undo the harness's own
  // auth stubs.
  afterEach(() => {
    vi.useRealTimers()
    completion.mockRestore()
  })

  const uploadUrl = (clientKey: string, config = ownerHeaders(slug)) =>
    service.client.post(
      '/v1/constituent-feedback/audio-upload-url',
      { clientKey },
      config,
    )

  // An answered knock on the first door, then its memo sent as a recording.
  const recordOffline = async (config = ownerHeaders(slug)) => {
    const target = targets[0]!
    const row = await knock(service, {
      slug,
      outreachId,
      personId: target.personId,
    })
    const clientKey = row.sourceId!
    const url = await uploadUrl(clientKey, config)
    const res = await service.client.post(
      '/v1/constituent-feedback',
      {
        channel: 'door_knock',
        knockClientKey: row.sourceId,
        stopTargetId: target.id,
        clientKey,
        audioKey: url.data?.audioKey,
        captureMethod: 'dictation_offline',
      },
      config,
    )
    return { res, url }
  }

  const row = (id: string) =>
    service.prisma.constituentFeedback.findUniqueOrThrow({ where: { id } })

  describe('POST audio-upload-url', () => {
    it('hands out a key under the org and a URL to put the audio at', async () => {
      const clientKey = randomUUID()
      const before = Date.now()

      const res = await uploadUrl(clientKey)

      expect(res.status).toBe(201)
      expect(res.data.audioKey).toBe(
        `constituent-feedback/${slug}/${clientKey}.webm`,
      )
      expect(() => new URL(res.data.uploadUrl)).not.toThrow()
      const expiresInMs = new Date(res.data.expiresAt).getTime() - before
      expect(expiresInMs).toBeGreaterThan(14 * 60_000)
      expect(expiresInMs).toBeLessThanOrEqual(15 * 60_000 + 5_000)
    })

    // The mock's URL is gp-api's own sink, reached through the webapp's
    // /api proxy, so a laptop runs the whole upload with no bucket.
    it('takes the audio at the mock sink', async () => {
      const res = await uploadUrl(randomUUID())
      const path = new URL(res.data.uploadUrl).pathname.replace(/^\/api/, '')

      const put = await service.client.put(path, Buffer.from('fake audio'), {
        headers: {
          'x-organization-slug': slug,
          'Content-Type': 'audio/webm;codecs=opus',
        },
        validateStatus: () => true,
      })

      expect(put.status).toBe(204)
    })

    it('404s when the product flag is off', async () => {
      const flags = vi
        .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
        .mockImplementation(
          async ({ feature }) => feature === 'serve-issue-capture',
        )
      onTestFinished(() => flags.mockRestore())

      const res = await uploadUrl(randomUUID())

      expect(res.status).toBe(404)
    })
  })

  describe('POST / with a recording', () => {
    it('saves the memo pending, with no text yet, and starts a job', async () => {
      const { res, url } = await recordOffline()

      expect(res.status).toBe(201)
      expect(res.data.extractionStatus).toBe('pending')
      expect(res.data.extraction).toBeNull()
      const saved = await row(res.data.id)
      expect(saved.transcript).toBeNull()
      expect(saved.audioKey).toBe(url.data.audioKey)
      expect(saved.captureMethod).toBe(
        ConstituentFeedbackCaptureMethod.dictation_offline,
      )
      expect(saved.extractionStatus).toBe(
        ConstituentFeedbackExtractionStatus.pending,
      )
      expect(saved.transcriptionJobName).not.toBeNull()
      expect(saved.confirmedAt).toBeNull()
    })

    // A key the upload route did not hand out for this memo could name
    // another memo's audio, or another org's.
    it('refuses a recording key that is not this memo’s', async () => {
      const target = targets[0]!
      const knocked = await knock(service, {
        slug,
        outreachId,
        personId: target.personId,
      })

      const res = await service.client.post(
        '/v1/constituent-feedback',
        {
          channel: 'door_knock',
          knockClientKey: knocked.sourceId,
          stopTargetId: target.id,
          clientKey: knocked.sourceId,
          audioKey: `constituent-feedback/someone-else/${knocked.sourceId}.webm`,
          captureMethod: 'dictation_offline',
        },
        ownerHeaders(slug),
      )

      expect(res.status).toBe(400)
    })

    it('lets an assigned volunteer send a recording', async () => {
      const volunteer = await createVolunteer(slug)
      await assign(slug, outreachId, volunteer.user.id)

      const { res } = await recordOffline(volunteer.config)

      expect(res.status).toBe(201)
      expect((await row(res.data.id)).actorUserId).toBe(volunteer.user.id)
    })

    // The same 404 the knock route and the transcript path give, before a
    // row or a job exists.
    it('refuses a volunteer not assigned to the effort', async () => {
      const volunteer = await createVolunteer(slug)

      const { res } = await recordOffline(volunteer.config)

      expect(res.status).toBe(404)
      const rows = await service.prisma.constituentFeedback.findMany({
        where: { organizationSlug: slug },
      })
      expect(rows).toHaveLength(0)
    })
  })

  describe('the pending transcription cron', () => {
    it('fills the transcript when the job finishes, then extracts it', async () => {
      const { res } = await recordOffline()
      const cron = service.app.get(PendingTranscriptionService)

      // Under three seconds in: the mock job is still running.
      await cron.pass(FIRST_SLOT)
      expect((await row(res.data.id)).transcript).toBeNull()

      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(Date.now() + 4_000)
      await cron.pass(NEXT_SLOT)

      const saved = await row(res.data.id)
      expect(SEED_MEMOS.map((memo) => memo.transcript)).toContain(
        saved.transcript,
      )
      expect(saved.extractionStatus).toBe(
        ConstituentFeedbackExtractionStatus.extracted,
      )
      expect(saved.proposedIssueLabel).toBe('Street flooding')
      expect(saved.issueLabel).toBe('Street flooding')
      expect(saved.stance).toBe('opposes')
      expect(saved.effortQuestion).toBe('What should the town fix first?')
      // Extracted is not confirmed: only the review list sets this.
      expect(saved.confirmedAt).toBeNull()
    })

    it('starts a job for a memo whose first start failed', async () => {
      const { res } = await recordOffline()
      await service.prisma.constituentFeedback.update({
        where: { id: res.data.id },
        data: { transcriptionJobName: null },
      })

      await service.app.get(PendingTranscriptionService).pass(FIRST_SLOT)

      expect((await row(res.data.id)).transcriptionJobName).not.toBeNull()
    })
  })

  describe('GET pending', () => {
    const pending = (config = ownerHeaders(slug)) =>
      service.client.get('/v1/constituent-feedback/pending', {
        ...config,
        params: { outreachId },
      })

    it('shows a volunteer their own notes and a manager everyone’s', async () => {
      const volunteer = await createVolunteer(slug)
      await assign(slug, outreachId, volunteer.user.id)
      const { res: theirs } = await recordOffline(volunteer.config)
      const { memo: ownersPending } = await seedKnockMemo(service, {
        slug,
        outreachId,
        personId: targets[1]!.personId,
        confirmed: false,
      })
      // Confirmed already, so it is nobody's to review.
      await seedKnockMemo(service, {
        slug,
        outreachId,
        personId: targets[2]!.personId,
      })

      const asVolunteer = await pending(volunteer.config)
      const asOwner = await pending()

      expect(asVolunteer.status).toBe(200)
      expect(
        asVolunteer.data.feedback.map((memo: { id: string }) => memo.id),
      ).toEqual([theirs.data.id])
      expect(asOwner.status).toBe(200)
      expect(
        asOwner.data.feedback.map((memo: { id: string }) => memo.id).sort(),
      ).toEqual([theirs.data.id, ownersPending.id].sort())
    })
  })

  // "Type it instead" re-records the memo as typed text, so it needs what a
  // capture posts: the memo's own clientKey and its knock or call.
  describe('re-recording a pending memo as typed text', () => {
    const pending = () =>
      service.client.get('/v1/constituent-feedback/pending', {
        ...ownerHeaders(slug),
        params: { outreachId },
      })

    it('hands back a door memo’s reference, and the typed re-record replaces it', async () => {
      const { res: recorded } = await recordOffline()
      await service.prisma.constituentFeedback.update({
        where: { id: recorded.data.id },
        data: { extractionStatus: ConstituentFeedbackExtractionStatus.failed },
      })
      const knocked =
        await service.prisma.contactInteractionDoorKnock.findFirstOrThrow({
          where: { organizationSlug: slug },
        })

      const listed = await pending()
      const memo = listed.data.feedback[0]
      expect(memo.clientKey).toBe(knocked.sourceId)
      expect(memo.reference).toEqual({
        channel: 'door_knock',
        knockClientKey: knocked.sourceId,
        stopTargetId: targets[0]!.id,
      })

      const typed = await service.client.post(
        '/v1/constituent-feedback',
        {
          ...memo.reference,
          clientKey: memo.clientKey,
          transcript: 'The storm drain on her corner floods every spring.',
          captureMethod: 'typed',
        },
        ownerHeaders(slug),
      )

      expect(typed.status).toBe(201)
      expect(typed.data.id).toBe(recorded.data.id)
      expect(typed.data.extraction).toEqual({
        issueLabel: 'Street flooding',
        stance: 'opposes',
        desiredOutcome: 'Clear the storm drain',
      })
      const saved = await row(recorded.data.id)
      expect(saved.transcript).toBe(
        'The storm drain on her corner floods every spring.',
      )
      expect(saved.captureMethod).toBe(ConstituentFeedbackCaptureMethod.typed)
      expect(saved.audioKey).toBeNull()
      expect(saved.extractionStatus).toBe(
        ConstituentFeedbackExtractionStatus.extracted,
      )
      expect(saved.confirmedAt).toBeNull()
    })

    it('hands back a call memo’s reference', async () => {
      const phone = await seedPhoneEffort(service, slug, { people: 2 })
      const entry = phone.entries[1]!
      const called = await call(service, {
        slug,
        listId: phone.listId,
        personId: entry.personId,
      })
      const memo = await seedCallMemo(service, {
        slug,
        outreachId: phone.outreachId,
        phoneBankingInteractionId: called.id,
        personId: entry.personId,
      })
      await service.prisma.constituentFeedback.update({
        where: { id: memo.id },
        data: { confirmedAt: null },
      })

      const listed = await service.client.get(
        '/v1/constituent-feedback/pending',
        { ...ownerHeaders(slug), params: { outreachId: phone.outreachId } },
      )

      expect(listed.data.feedback).toHaveLength(1)
      expect(listed.data.feedback[0].clientKey).toBe(memo.clientKey)
      expect(listed.data.feedback[0].reference).toEqual({
        channel: 'phone_bank',
        entryId: entry.id,
        personId: entry.personId,
      })
    })
  })

  describe('POST :id/retry', () => {
    it('re-runs a failed extraction', async () => {
      const { memo } = await seedKnockMemo(service, {
        slug,
        outreachId,
        personId: targets[0]!.personId,
        confirmed: false,
      })
      await service.prisma.constituentFeedback.update({
        where: { id: memo.id },
        data: {
          extractionStatus: ConstituentFeedbackExtractionStatus.failed,
          issueLabel: null,
          stance: null,
        },
      })

      const res = await service.client.post(
        `/v1/constituent-feedback/${memo.id}/retry`,
        {},
        ownerHeaders(slug),
      )

      expect(res.status).toBe(201)
      expect(res.data.extractionStatus).toBe('extracted')
      expect(res.data.issueLabel).toBe('Street flooding')
      expect(res.data.confirmedAt).toBeNull()
    })

    it('re-runs a failed transcription', async () => {
      const { res: recorded } = await recordOffline()
      await service.prisma.constituentFeedback.update({
        where: { id: recorded.data.id },
        data: {
          extractionStatus: ConstituentFeedbackExtractionStatus.failed,
          transcriptionJobName: null,
        },
      })

      const res = await service.client.post(
        `/v1/constituent-feedback/${recorded.data.id}/retry`,
        {},
        ownerHeaders(slug),
      )

      expect(res.status).toBe(201)
      expect(res.data.extractionStatus).toBe('pending')
      expect((await row(recorded.data.id)).transcriptionJobName).not.toBeNull()
    })

    it('refuses a volunteer someone else’s note', async () => {
      const volunteer = await createVolunteer(slug)
      await assign(slug, outreachId, volunteer.user.id)
      const { memo } = await seedKnockMemo(service, {
        slug,
        outreachId,
        personId: targets[0]!.personId,
        confirmed: false,
      })

      const res = await service.client.post(
        `/v1/constituent-feedback/${memo.id}/retry`,
        {},
        volunteer.config,
      )

      expect(res.status).toBe(404)
    })
  })
})

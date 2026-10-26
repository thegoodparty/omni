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
import { ISSUE_CAPTURE_OFF_ERROR_CODE } from '@goodparty_org/contracts'
import {
  ConstituentFeedbackCaptureMethod,
  ConstituentFeedbackConfirmation,
  ConstituentFeedbackExtractionStatus,
  OrganizationRole,
} from '@/generated/prisma'
import { AnalyticsService } from '@/analytics/analytics.service'
import { FeaturesService } from '@/features/services/features.service'
import { LlmService } from '@/llm/services/llm.service'
import { useTestService } from '@/test-service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { SEED_MEMOS } from '../services/feedbackSeedMemos'
import { TranscribeFileService } from '@/speech/services/transcribeFile.service'
import {
  ABANDONED_CONFIRM_AFTER_HOURS,
  MAX_TRANSCRIPTION_ATTEMPTS,
  PendingTranscriptionService,
  START_RETRY_AFTER_MINUTES,
} from '../services/pendingTranscription.service'
import { ConstituentFeedbackService } from '../services/constituentFeedback.service'
import { ConstituentFeedbackExtractionService } from '../services/constituentFeedbackExtraction.service'
import {
  createWinOrg,
  knock,
  ownerHeaders,
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

// Distinct cron slots far from the wall clock, so no claim keyed on the
// current minute can hold the one a test pass needs.
const FIRST_SLOT = new Date('2026-01-01T00:00:00.000Z')
const NEXT_SLOT = new Date('2026-01-01T00:01:00.000Z')
const THIRD_SLOT = new Date('2026-01-01T00:02:00.000Z')

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
          issues: [
            {
              issueLabel: 'Street flooding',
              stance: 'opposes',
              desiredOutcome: 'Clear the storm drain',
            },
          ],
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
      { clientKey, contentType: 'audio/webm;codecs=opus' },
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
    service.prisma.constituentFeedback.findUniqueOrThrow({
      where: { id },
      include: { issues: true },
    })

  // The calls made for one event. The service sends them without awaiting,
  // so a test reads them with waitFor.
  const spyOnTrack = () => {
    const track = vi
      .spyOn(service.app.get(AnalyticsService), 'track')
      .mockResolvedValue({ event: 'stub', userId: 'stub' })
    onTestFinished(() => track.mockRestore())
    return (event: string) =>
      track.mock.calls.filter(([, name]) => name === event)
  }

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
      expect(res.data.fields).toEqual({})
      const expiresInMs = new Date(res.data.expiresAt).getTime() - before
      expect(expiresInMs).toBeGreaterThan(14 * 60_000)
      expect(expiresInMs).toBeLessThanOrEqual(15 * 60_000 + 5_000)
    })

    // The mock's URL is gp-api's own sink, reached through the webapp's
    // /api proxy, so a laptop runs the whole upload with no bucket.
    const postToSink = async () => {
      const res = await uploadUrl(randomUUID())
      const path = new URL(res.data.uploadUrl).pathname.replace(/^\/api/, '')
      const form = new FormData()
      form.append(
        'file',
        new Blob([Buffer.from('fake audio')], { type: 'audio/webm' }),
        'memo.webm',
      )
      return service.client.post(path, form, {
        headers: { 'x-organization-slug': slug },
        validateStatus: () => true,
      })
    }

    it('takes the audio at the mock sink', async () => {
      expect((await postToSink()).status).toBe(204)
    })

    // A write seam, so never on prod even if the mode were left on there.
    it('has no mock sink on prod', async () => {
      vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')
      onTestFinished(() => {
        vi.unstubAllEnvs()
      })

      expect((await postToSink()).status).toBe(404)
    })

    // The code is what tells a phone holding the memo to keep it.
    it('404s, naming the flag, when issue-capture is off', async () => {
      const flags = vi
        .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
        .mockImplementation(async ({ feature }) => feature !== 'issue-capture')
      onTestFinished(() => flags.mockRestore())

      const res = await uploadUrl(randomUUID())

      expect(res.status).toBe(404)
      expect(res.data.errorCode).toBe(ISSUE_CAPTURE_OFF_ERROR_CODE)
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
    const cron = () => service.app.get(PendingTranscriptionService)

    const proposal = (feedbackId: string) =>
      service.prisma.constituentFeedbackUnreviewedIssue.findMany({
        where: { feedbackId },
        orderBy: { position: 'asc' },
      })

    const failEveryJob = () => {
      const poll = vi
        .spyOn(service.app.get(TranscribeFileService), 'fetchResult')
        .mockResolvedValue({ status: 'failed', reason: 'unsupported media' })
      onTestFinished(() => poll.mockRestore())
    }

    // Nobody who was at the door will see it again, so the memo is confirmed
    // with its words and no issues; the model's proposal is kept apart.
    it('transcribes, extracts and confirms the memo automatically', async () => {
      const { res } = await recordOffline()

      // Under three seconds in: the mock job is still running.
      await cron().pass(FIRST_SLOT)
      expect((await row(res.data.id)).transcript).toBeNull()

      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(Date.now() + 4_000)
      await cron().pass(NEXT_SLOT)

      const saved = await row(res.data.id)
      expect(SEED_MEMOS.map((memo) => memo.transcript)).toContain(
        saved.transcript,
      )
      expect(saved.extractionStatus).toBe(
        ConstituentFeedbackExtractionStatus.extracted,
      )
      expect(saved.effortQuestion).toBe('What should the town fix first?')
      expect(saved.confirmedAt).not.toBeNull()
      expect(saved.confirmation).toBe(ConstituentFeedbackConfirmation.automatic)
      expect(saved.issues).toEqual([])
      expect(await proposal(res.data.id)).toEqual([
        expect.objectContaining({
          position: 0,
          issueLabel: 'Street flooding',
          stance: 'opposes',
          desiredOutcome: 'Clear the storm drain',
        }),
      ])
    })

    // Themes need only the words, so a failed extraction confirms too.
    it('confirms the memo when extraction fails', async () => {
      const extract = vi
        .spyOn(service.app.get(ConstituentFeedbackExtractionService), 'extract')
        .mockResolvedValue(null)
      onTestFinished(() => extract.mockRestore())
      const { res } = await recordOffline()
      const poll = vi
        .spyOn(service.app.get(TranscribeFileService), 'fetchResult')
        .mockResolvedValue({
          status: 'completed',
          transcript: 'She wants the storm drain cleared.',
        })
      onTestFinished(() => poll.mockRestore())

      await cron().pass(FIRST_SLOT)

      const saved = await row(res.data.id)
      expect(saved.transcript).toBe('She wants the storm drain cleared.')
      expect(saved.extractionStatus).toBe(
        ConstituentFeedbackExtractionStatus.failed,
      )
      expect(saved.confirmedAt).not.toBeNull()
      expect(saved.confirmation).toBe(ConstituentFeedbackConfirmation.automatic)
      expect(saved.issues).toEqual([])
      expect(await proposal(res.data.id)).toEqual([])
    })

    // Neither the confirm step nor its Skip ever sees an offline memo, so
    // the server reports the confirmation. Enums only, never what was said.
    it('reports the automatic confirmation without what anyone said', async () => {
      const calls = spyOnTrack()
      await recordOffline()
      const poll = vi
        .spyOn(service.app.get(TranscribeFileService), 'fetchResult')
        .mockResolvedValue({
          status: 'completed',
          transcript: 'She wants the storm drain cleared.',
        })
      onTestFinished(() => poll.mockRestore())

      await cron().pass(FIRST_SLOT)

      await vi.waitFor(() =>
        expect(calls(EVENTS.IssueCapture.MemoAutoConfirmed)).toEqual([
          [
            service.user.id,
            EVENTS.IssueCapture.MemoAutoConfirmed,
            {
              reason: 'offline_transcribed',
              channel: 'doorKnocking',
              product: 'win',
            },
          ],
        ]),
      )
    })

    it('starts a new job after a failed one, and gives up after three', async () => {
      const { res } = await recordOffline()
      failEveryJob()
      const jobNames = [(await row(res.data.id)).transcriptionJobName]

      await cron().pass(FIRST_SLOT)
      jobNames.push((await row(res.data.id)).transcriptionJobName)
      await cron().pass(NEXT_SLOT)
      jobNames.push((await row(res.data.id)).transcriptionJobName)

      const retried = await row(res.data.id)
      expect(new Set(jobNames).size).toBe(MAX_TRANSCRIPTION_ATTEMPTS)
      expect(retried.transcriptionAttempts).toBe(MAX_TRANSCRIPTION_ATTEMPTS)
      expect(retried.extractionStatus).toBe(
        ConstituentFeedbackExtractionStatus.pending,
      )

      await cron().pass(THIRD_SLOT)

      const unreadable = await row(res.data.id)
      expect(unreadable.extractionStatus).toBe(
        ConstituentFeedbackExtractionStatus.failed,
      )
      expect(unreadable.transcript).toBeNull()
      expect(unreadable.confirmedAt).toBeNull()
    })

    // Transcribe's failure text is the vendor's, not a category a chart can
    // group by, so the event says the job failed.
    it('reports a memo no job could read once it gives up', async () => {
      const calls = spyOnTrack()
      await recordOffline()
      failEveryJob()

      await cron().pass(FIRST_SLOT)
      await cron().pass(NEXT_SLOT)
      expect(calls(EVENTS.IssueCapture.MemoTranscriptionFailed)).toEqual([])
      await cron().pass(THIRD_SLOT)

      await vi.waitFor(() =>
        expect(calls(EVENTS.IssueCapture.MemoTranscriptionFailed)).toEqual([
          [
            service.user.id,
            EVENTS.IssueCapture.MemoTranscriptionFailed,
            { reason: 'job_failed', channel: 'doorKnocking', product: 'win' },
          ],
        ]),
      )
    })

    const minutesOn = (minutes: number) =>
      new Date(Date.now() + minutes * 60_000)

    it('counts a job that fails to start as an attempt', async () => {
      const start = vi
        .spyOn(service.app.get(TranscribeFileService), 'transcribeFile')
        .mockRejectedValue(new Error('Transcribe unavailable'))
      onTestFinished(() => start.mockRestore())
      const { res } = await recordOffline()
      expect((await row(res.data.id)).transcriptionAttempts).toBe(1)

      await cron().pass(minutesOn(START_RETRY_AFTER_MINUTES + 1))
      await cron().pass(minutesOn(2 * START_RETRY_AFTER_MINUTES + 2))
      expect(start).toHaveBeenCalledTimes(MAX_TRANSCRIPTION_ATTEMPTS)
      await cron().pass(minutesOn(3 * START_RETRY_AFTER_MINUTES + 3))

      const saved = await row(res.data.id)
      expect(start).toHaveBeenCalledTimes(MAX_TRANSCRIPTION_ATTEMPTS)
      expect(saved.transcriptionJobName).toBeNull()
      expect(saved.extractionStatus).toBe(
        ConstituentFeedbackExtractionStatus.failed,
      )
    })

    // A start that failed in an outage is not tried again inside it.
    it('waits before starting again after a failed start', async () => {
      const start = vi
        .spyOn(service.app.get(TranscribeFileService), 'transcribeFile')
        .mockRejectedValueOnce(new Error('Transcribe unavailable'))
      onTestFinished(() => start.mockRestore())
      const { res } = await recordOffline()

      await cron().pass(minutesOn(1))
      await cron().pass(minutesOn(START_RETRY_AFTER_MINUTES - 1))

      expect(start).toHaveBeenCalledOnce()
      expect((await row(res.data.id)).transcriptionJobName).toBeNull()

      await cron().pass(minutesOn(START_RETRY_AFTER_MINUTES + 1))

      expect(start).toHaveBeenCalledTimes(2)
      const saved = await row(res.data.id)
      expect(saved.transcriptionJobName).not.toBeNull()
      expect(saved.transcriptionAttempts).toBe(2)
    })

    // Silence transcribes to nothing, and another job would hear the same.
    it('fails a silent recording at once', async () => {
      const { res } = await recordOffline()
      const poll = vi
        .spyOn(service.app.get(TranscribeFileService), 'fetchResult')
        .mockResolvedValue({ status: 'completed', transcript: '  ' })
      onTestFinished(() => poll.mockRestore())

      await cron().pass(FIRST_SLOT)

      const saved = await row(res.data.id)
      expect(saved.extractionStatus).toBe(
        ConstituentFeedbackExtractionStatus.failed,
      )
      expect(saved.transcriptionAttempts).toBe(1)
      expect(saved.confirmedAt).toBeNull()
    })

    it('reports a silent recording as empty', async () => {
      const calls = spyOnTrack()
      await recordOffline()
      const poll = vi
        .spyOn(service.app.get(TranscribeFileService), 'fetchResult')
        .mockResolvedValue({ status: 'completed', transcript: '  ' })
      onTestFinished(() => poll.mockRestore())

      await cron().pass(FIRST_SLOT)

      await vi.waitFor(() =>
        expect(calls(EVENTS.IssueCapture.MemoTranscriptionFailed)).toEqual([
          [
            service.user.id,
            EVENTS.IssueCapture.MemoTranscriptionFailed,
            {
              reason: 'empty_transcript',
              channel: 'doorKnocking',
              product: 'win',
            },
          ],
        ]),
      )
      expect(calls(EVENTS.IssueCapture.MemoAutoConfirmed)).toEqual([])
    })

    // An hour with no word counts as a failed job: another starts while
    // attempts remain, and the memo is marked failed once they are spent.
    it('treats a job still running an hour on as failed', async () => {
      const { res } = await recordOffline()
      const poll = vi
        .spyOn(service.app.get(TranscribeFileService), 'fetchResult')
        .mockResolvedValue({ status: 'in_progress' })
      onTestFinished(() => poll.mockRestore())
      const { transcriptionJobName: first } = await row(res.data.id)

      await cron().pass(new Date(Date.now() + 61 * 60_000))

      const restarted = await row(res.data.id)
      expect(restarted.transcriptionJobName).not.toBe(first)
      expect(restarted.transcriptionAttempts).toBe(2)
      expect(restarted.extractionStatus).toBe(
        ConstituentFeedbackExtractionStatus.pending,
      )

      await service.prisma.constituentFeedback.update({
        where: { id: res.data.id },
        data: { transcriptionAttempts: MAX_TRANSCRIPTION_ATTEMPTS },
      })
      await cron().pass(new Date(Date.now() + 122 * 60_000))

      expect((await row(res.data.id)).extractionStatus).toBe(
        ConstituentFeedbackExtractionStatus.failed,
      )
    })

    // Polled before the give-up: a job that finished while the cron was not
    // running is read, not failed.
    it('reads a job that finished while nobody polled it', async () => {
      const { res } = await recordOffline()
      const poll = vi
        .spyOn(service.app.get(TranscribeFileService), 'fetchResult')
        .mockResolvedValue({
          status: 'completed',
          transcript: 'She wants the storm drain cleared.',
        })
      onTestFinished(() => poll.mockRestore())

      await cron().pass(new Date(Date.now() + 61 * 60_000))

      const saved = await row(res.data.id)
      expect(saved.transcript).toBe('She wants the storm drain cleared.')
      expect(saved.extractionStatus).toBe(
        ConstituentFeedbackExtractionStatus.extracted,
      )
    })

    // Confirmed while its job ran: the person who was there has spoken, and
    // a late model guess must not replace their word. The cron read the row
    // before the confirm landed, so its completion still arrives.
    const confirmMidJob = async () => {
      const { res } = await recordOffline()
      const confirmed = await service.client.patch(
        `/v1/constituent-feedback/${res.data.id}/confirm`,
        {
          issues: [
            {
              issueLabel: 'Compost pickup',
              stance: 'supports',
              desiredOutcome: 'Collect it weekly',
            },
          ],
        },
        ownerHeaders(slug),
      )
      expect(confirmed.status).toBe(200)
      return res.data.id as string
    }

    it('leaves a memo confirmed mid-job as it was confirmed', async () => {
      const id = await confirmMidJob()
      const { transcriptionJobName } = await row(id)

      await service.app.get(ConstituentFeedbackService).completeTranscription({
        id,
        jobName: transcriptionJobName!,
        transcript: 'She wants the storm drain cleared.',
      })

      const saved = await row(id)
      expect(saved.confirmedAt).not.toBeNull()
      expect(saved.confirmation).toBe(ConstituentFeedbackConfirmation.reviewed)
      expect(saved.issues).toEqual([
        expect.objectContaining({
          position: 0,
          issueLabel: 'Compost pickup',
          stance: 'supports',
          desiredOutcome: 'Collect it weekly',
          proposedIssueLabel: null,
        }),
      ])
    })

    // The failure twin: the cron read the row, the confirm landed while it
    // polled, then the job failed. The confirmed memo gets no new job and is
    // not marked failed.
    it('leaves a memo confirmed mid-job as it was when the job fails', async () => {
      const { res } = await recordOffline()
      const id = res.data.id as string
      const { transcriptionJobName } = await row(id)
      const poll = vi
        .spyOn(service.app.get(TranscribeFileService), 'fetchResult')
        .mockImplementation(async () => {
          const confirmed = await service.client.patch(
            `/v1/constituent-feedback/${id}/confirm`,
            {
              issues: [
                {
                  issueLabel: 'Compost pickup',
                  stance: 'supports',
                  desiredOutcome: 'Collect it weekly',
                },
              ],
            },
            ownerHeaders(slug),
          )
          expect(confirmed.status).toBe(200)
          return { status: 'failed', reason: 'unsupported media' }
        })
      onTestFinished(() => poll.mockRestore())

      await cron().pass(FIRST_SLOT)

      expect(poll).toHaveBeenCalledOnce()
      const saved = await row(id)
      expect(saved.confirmedAt).not.toBeNull()
      expect(saved.transcriptionJobName).toBe(transcriptionJobName)
      expect(saved.extractionStatus).toBe(
        ConstituentFeedbackExtractionStatus.pending,
      )
      expect(saved.issues).toEqual([
        expect.objectContaining({ issueLabel: 'Compost pickup' }),
      ])
    })

    // Giving up keeps the job's name on the row, so a job that answers after
    // that must not confirm a memo the report already shows as unreadable.
    it('leaves a memo marked unreadable alone when its job answers late', async () => {
      const { res } = await recordOffline()
      const id = res.data.id as string
      const { transcriptionJobName } = await row(id)
      const feedback = service.app.get(ConstituentFeedbackService)
      await feedback.failTranscription({
        id,
        jobName: transcriptionJobName,
        reason: 'timeout',
      })

      await feedback.completeTranscription({
        id,
        jobName: transcriptionJobName!,
        transcript: 'She wants the storm drain cleared.',
      })

      const saved = await row(id)
      expect(saved.extractionStatus).toBe(
        ConstituentFeedbackExtractionStatus.failed,
      )
      expect(saved.transcript).toBeNull()
      expect(saved.confirmedAt).toBeNull()
      expect(saved.confirmation).toBeNull()
      expect(await proposal(id)).toEqual([])
    })

    it('stops polling a memo once it is confirmed', async () => {
      await confirmMidJob()
      const poll = vi.spyOn(
        service.app.get(TranscribeFileService),
        'fetchResult',
      )
      onTestFinished(() => poll.mockRestore())

      await cron().pass(FIRST_SLOT)

      expect(poll).not.toHaveBeenCalled()
    })

    it('starts a job for a memo whose first start failed', async () => {
      const { res } = await recordOffline()
      await service.prisma.constituentFeedback.update({
        where: { id: res.data.id },
        data: { transcriptionJobName: null },
      })

      await cron().pass(minutesOn(START_RETRY_AFTER_MINUTES + 1))

      expect((await row(res.data.id)).transcriptionJobName).not.toBeNull()
    })
  })

  // A live memo whose confirm step never finished, because the app closed on
  // the card, is confirmed the way a skip is once it has sat untouched.
  describe('the abandoned confirm sweep', () => {
    const recordLive = async () => {
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
          transcript: 'The storm drain on her corner floods every spring.',
          captureMethod: 'dictation',
        },
        ownerHeaders(slug),
      )
      expect(res.status).toBe(201)
      return res.data.id as string
    }

    const hoursOn = (hours: number) =>
      new Date(Date.now() + hours * 60 * 60_000)

    it('confirms a memo left unconfirmed past the cutoff', async () => {
      const id = await recordLive()

      await service.app
        .get(PendingTranscriptionService)
        .pass(hoursOn(ABANDONED_CONFIRM_AFTER_HOURS + 1))

      const saved = await row(id)
      expect(saved.confirmedAt).not.toBeNull()
      expect(saved.confirmation).toBe(ConstituentFeedbackConfirmation.automatic)
      expect(saved.issues).toEqual([])
      expect(
        await service.prisma.constituentFeedbackUnreviewedIssue.findMany({
          where: { feedbackId: id },
        }),
      ).toEqual([
        expect.objectContaining({
          position: 0,
          issueLabel: 'Street flooding',
          stance: 'opposes',
        }),
      ])
    })

    it('reports the abandoned confirm step', async () => {
      const calls = spyOnTrack()
      await recordLive()

      await service.app
        .get(PendingTranscriptionService)
        .pass(hoursOn(ABANDONED_CONFIRM_AFTER_HOURS + 1))

      await vi.waitFor(() =>
        expect(calls(EVENTS.IssueCapture.MemoAutoConfirmed)).toEqual([
          [
            service.user.id,
            EVENTS.IssueCapture.MemoAutoConfirmed,
            { reason: 'abandoned', channel: 'doorKnocking', product: 'win' },
          ],
        ]),
      )
    })

    it('leaves a memo still inside the cutoff alone', async () => {
      const id = await recordLive()

      await service.app
        .get(PendingTranscriptionService)
        .pass(hoursOn(ABANDONED_CONFIRM_AFTER_HOURS - 1))

      const saved = await row(id)
      expect(saved.confirmedAt).toBeNull()
      expect(saved.issues).toHaveLength(1)
    })

    // The sweep read the memo, then the canvasser confirmed it before the
    // sweep wrote: their confirmation stands.
    it('leaves a memo confirmed after the sweep read it', async () => {
      const calls = spyOnTrack()
      const id = await recordLive()
      const { updatedAt, issues } = await row(id)
      const confirmed = await service.client.patch(
        `/v1/constituent-feedback/${id}/confirm`,
        {
          issues: [
            {
              issueLabel: 'Storm drains',
              stance: 'opposes',
              desiredOutcome: 'Clear them',
              fromIssueId: issues[0]!.id,
            },
          ],
        },
        ownerHeaders(slug),
      )
      expect(confirmed.status).toBe(200)

      await service.app
        .get(ConstituentFeedbackService)
        .confirmAbandoned({ id, updatedAt })

      const saved = await row(id)
      expect(saved.confirmation).toBe(ConstituentFeedbackConfirmation.reviewed)
      expect(saved.issues).toEqual([
        expect.objectContaining({
          issueLabel: 'Storm drains',
          proposedIssueLabel: 'Street flooding',
        }),
      ])
      expect(
        await service.prisma.constituentFeedbackUnreviewedIssue.count({
          where: { feedbackId: id },
        }),
      ).toBe(0)
      expect(calls(EVENTS.IssueCapture.MemoAutoConfirmed)).toEqual([])
    })
  })

  it('has no review list and no retry route', async () => {
    const { res } = await recordOffline()

    const pending = await service.client.get(
      '/v1/constituent-feedback/pending',
      { ...ownerHeaders(slug), params: { outreachId } },
    )
    const retry = await service.client.post(
      `/v1/constituent-feedback/${res.data.id}/retry`,
      {},
      ownerHeaders(slug),
    )

    expect(pending.status).toBe(404)
    expect(retry.status).toBe(404)
  })
})

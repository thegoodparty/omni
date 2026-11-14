import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { CandidateSmsTestResponse } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { PeerlyP2pJobService } from 'src/vendors/peerly/services/peerlyP2pJob.service'
import { PeerlyTestListService } from 'src/vendors/peerly/services/peerlyTestList.service'
import { NOT_CELL_MESSAGE } from 'src/vendors/peerly/utils/peerlyTestSendRejection.util'
import { OutreachStatus, OutreachType } from '../../generated/prisma'

const testSendCooldownMs = () =>
  Number(process.env.TEST_SEND_COOLDOWN_MS ?? 30_000)

type TestSendRow = { id: number; projectId: string; identityId: string }

type TestSendResult = CandidateSmsTestResponse['results'][number]

// The one place a test text reaches Peerly, shared by the staff console and
// the candidate's own test: one cool-off per row across both callers.
@Injectable()
export class SmsTestSendService extends createPrismaBase(MODELS.Outreach) {
  // Per-row claims (outreachId -> claimed-at ms), per-process like the
  // admin vendor-read maps: the goal is one test per click, not a
  // cluster-wide lock.
  private readonly claims = new Map<number, number>()

  constructor(
    private readonly peerlyP2pJobService: PeerlyP2pJobService,
    private readonly peerlyTestListService: PeerlyTestListService,
  ) {
    super()
  }

  // Peerly's test send takes the national 10-digit form ("3217891234").
  normalizeUsPhone(raw: string): string {
    const digits = raw.replace(/\D/g, '')
    const national =
      digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
    if (national.length !== 10) {
      throw new BadRequestException(
        'Enter a US phone number: 10 digits, or 11 starting with 1',
      )
    }
    return national
  }

  // Scoped by campaign so another campaign's row reads as missing. Numbers
  // come only from the request body, never from campaign or contact data.
  async sendForCandidate({
    outreachId,
    campaignId,
    phones,
  }: {
    outreachId: number
    campaignId: number
    phones: string[]
  }): Promise<CandidateSmsTestResponse> {
    const row = await this.findFirst({
      where: { id: outreachId, campaignId, outreachType: OutreachType.p2p },
    })
    if (!row) throw new NotFoundException('Text campaign not found')
    if (
      row.status === OutreachStatus.canceled ||
      row.status === OutreachStatus.completed
    ) {
      throw new ConflictException(
        'This text was canceled or has already sent, so it cannot be tested',
      )
    }
    if (!row.identityId) {
      throw new BadRequestException(
        'This text has no Peerly identity recorded, so a test cannot be sent',
      )
    }
    if (!row.projectId) {
      throw new ConflictException(
        'This text is still getting ready. Try the test again in a minute.',
      )
    }
    return this.send({
      row: { id: row.id, projectId: row.projectId, identityId: row.identityId },
      phones: phones.map((phone) => this.normalizeUsPhone(phone)),
    })
  }

  /**
   * Adds each distinct number to the identity's Peerly test list, then
   * creates ONE fresh test job and texts every accepted number on it. A
   * fresh job each time because Peerly clones the parent job's content at
   * creation (a reused one shows the script from before an edit) and refuses
   * a number twice on one job with "Lead already exists" (Peerly,
   * 2026-11-06), which is also why the numbers are deduped here. Peerly's
   * refusals of a number come back per number; any other failure throws.
   * The cool-off is claimed BEFORE the vendor calls so a double-click is
   * refused, and released when nothing was sent so a real error stays
   * retryable.
   */
  async send({
    row,
    phones,
  }: {
    row: TestSendRow
    phones: string[]
  }): Promise<CandidateSmsTestResponse> {
    this.claim(row.id)
    try {
      const results = await this.sendUnclaimed(row, [...new Set(phones)])
      if (!results.some(({ result }) => result === 'sent')) {
        this.claims.delete(row.id)
      }
      return { results }
    } catch (error) {
      this.claims.delete(row.id)
      throw error
    }
  }

  private claim(rowId: number) {
    const now = Date.now()
    for (const [id, claimedAt] of this.claims) {
      if (now - claimedAt >= testSendCooldownMs()) this.claims.delete(id)
    }
    if (this.claims.has(rowId)) {
      throw new ConflictException(
        'A test was just sent for this campaign — wait a moment before ' +
          'sending another',
      )
    }
    this.claims.set(rowId, now)
  }

  private async sendUnclaimed(
    row: TestSendRow,
    phones: string[],
  ): Promise<TestSendResult[]> {
    const results = new Map<string, TestSendResult>()
    const accepted: { phone: string; testListId: number }[] = []
    for (const phone of phones) {
      try {
        const testListId = await this.peerlyTestListService.resolveTestListId({
          identityId: row.identityId,
          phone,
        })
        accepted.push({ phone, testListId })
      } catch (error) {
        results.set(phone, this.refusal(phone, error))
      }
    }

    if (accepted.length > 0) {
      const testJobId = await this.peerlyP2pJobService.createTestJob(
        row.projectId,
      )
      for (const { phone, testListId } of accepted) {
        try {
          await this.peerlyP2pJobService.sendTestMessage(
            testJobId,
            phone,
            testListId,
          )
          results.set(phone, { phone, result: 'sent', message: null })
        } catch (error) {
          results.set(phone, this.refusal(phone, error))
        }
      }
    }
    return phones.flatMap((phone) => results.get(phone) ?? [])
  }

  // Peerly's expected refusals of a typed number arrive as a
  // BadRequestException carrying the message shown to the user; anything
  // else is ours or Peerly's to fix and propagates.
  private refusal(phone: string, error: unknown): TestSendResult {
    if (!(error instanceof BadRequestException)) throw error
    return {
      phone,
      result: error.message === NOT_CELL_MESSAGE ? 'not_cell' : 'failed',
      message: error.message,
    }
  }
}

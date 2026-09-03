import { BadGatewayException, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { RobocallVendor } from '@/outreach/vendor/robocallVendor'
import {
  CompletedCount,
  CreateBroadcastInput,
  CreatedBroadcast,
  DncPartition,
  LoadAudienceInput,
  LoadedAudience,
  RentNumberInput,
  RentedNumber,
  RobocallBroadcastStatus,
  UploadMediaInput,
  UploadedMedia,
} from '@/outreach/vendor/robocallVendor.types'
import { VendorPermanentError } from '@/outreach/vendor/vendorPermanentError'
import { sleep } from '@/shared/util/sleep.util'
import { NoInventoryError } from './noInventoryError'
import { CallfireBroadcastService } from './services/callfireBroadcast.service'
import {
  CallfireContactsService,
  ContactListStatus,
} from './services/callfireContacts.service'
import { CallfireDncService } from './services/callfireDnc.service'
import { CallfireMediaService } from './services/callfireMedia.service'
import { CallfireNumbersService } from './services/callfireNumbers.service'
import { CallfireResultsService } from './services/callfireResults.service'

// CallFire's list validation is asynchronous with no job id; poll getListStatus
// until it reads ACTIVE. Bounded so a stuck validation fails loudly instead of
// hanging the send step forever (mirrors CallHub's phonebook count poll).
const LIST_POLL_ATTEMPTS = 30
const LIST_POLL_DELAY_MS = 4000

// The presigned CSV is already a CSV of resolved recipients; CallFire ingests
// bytes, not a URL, so we download it and hand the buffer to the contacts API.
const AUDIENCE_CSV_FILE_NAME = 'audience.csv'
const AUDIENCE_CSV_MIME_TYPE = 'text/csv'

// The CallFire implementation of the vendor-neutral RobocallVendor port. It is a
// thin composition layer: each port method maps to one (or a couple of) CallFire
// service calls and translates the result into neutral shapes. No business logic
// lives here — the money and compliance gates stay in the send chain, and the
// create-then-launch split is preserved (createBroadcast never dials).
@Injectable()
export class CallfireRobocallVendor implements RobocallVendor {
  constructor(
    private readonly numbers: CallfireNumbersService,
    private readonly media: CallfireMediaService,
    private readonly contacts: CallfireContactsService,
    private readonly broadcast: CallfireBroadcastService,
    private readonly results: CallfireResultsService,
    private readonly dnc: CallfireDncService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CallfireRobocallVendor.name)
  }

  // The port contract guarantees that a defined area code with no CallFire
  // inventory DEGRADES to a national (no-prefix) rental rather than failing the
  // request. So attempt the area-code rental and, ONLY on a NoInventoryError
  // (the empty-search sentinel), retry once nationally. A transient
  // BadGatewayException (429 / auth / timeout) and a VendorPermanentError (a 4xx
  // a national retry can't fix, and which may already have placed a real order)
  // both propagate — falling back on either would swallow a retryable error or
  // trigger a wasted billable national purchase, so only a true no-inventory
  // degrades.
  async rentNumber(input: RentNumberInput): Promise<RentedNumber> {
    const areaCode = input.areaCode ?? ''
    let rented = await this.numbers.rentNumber({ areaCode }).catch((err) => {
      // Area-code search with no inventory falls back to a national rental
      // below.
      if (areaCode && err instanceof NoInventoryError) {
        return null
      }
      // No area code was requested: the search above was already national, so
      // a no-inventory result is terminal — surface a clean caller-facing
      // error rather than leaking the internal NoInventoryError sentinel.
      if (!areaCode && err instanceof NoInventoryError) {
        throw new BadGatewayException(
          'No CallFire national number available for rental',
        )
      }
      throw err
    })
    if (!rented) {
      this.logger.warn(
        { areaCode },
        'No CallFire inventory for area code; renting a national number',
      )
      rented = await this.numbers.rentNumber({ areaCode: '' }).catch((err) => {
        if (err instanceof NoInventoryError) {
          throw new BadGatewayException(
            'No CallFire national number available for rental',
          )
        }
        throw err
      })
    }
    return {
      phoneNumber: rented.phoneNumber,
      region: rented.region ?? null,
    }
  }

  async uploadMedia(input: UploadMediaInput): Promise<UploadedMedia> {
    const { mediaId } = await this.media.uploadSound({
      file: input.file,
      fileName: input.fileName,
      mimeType: input.mimeType,
    })
    return { mediaId }
  }

  // Downloads the hosted CSV and creates a CallFire contact list, then waits for
  // the async row validation to reach ACTIVE before the list is dial-safe. Takes
  // the CSV the caller already resolved — it does NOT resolve the audience, so
  // the upstream ROBOCALL_TEST_OVERRIDE_NUMBER chokepoint stays the single place
  // that decides which numbers are dialed.
  async loadAudience(input: LoadAudienceInput): Promise<LoadedAudience> {
    const file = await this.downloadCsv(input.csvUrl)
    const { listId } = await this.contacts.createListFromCsv({
      name: input.name,
      file,
      fileName: AUDIENCE_CSV_FILE_NAME,
      mimeType: AUDIENCE_CSV_MIME_TYPE,
    })
    const loadedCount = await this.waitForListReady(listId)
    return { audienceRef: listId, loadedCount }
  }

  // NON-DIALING create: ?start=false plus the list attach both happen inside the
  // broadcast service. Launching (the dial) is a separate method by design.
  async createBroadcast(
    input: CreateBroadcastInput,
  ): Promise<CreatedBroadcast> {
    const created = await this.broadcast.createBroadcast({
      name: input.name,
      fromNumber: input.callerId,
      // The neutral mediaId is a string handle; CallFire wants the numeric id.
      liveSoundId: Number(input.mediaId),
      contactListId: input.audienceRef,
      scheduledStart: input.scheduledStart,
    })
    return {
      campaignRef: created.campaignRef,
      startingDate: created.startingDate,
      expirationDate: created.expirationDate,
    }
  }

  launchBroadcast(campaignRef: string): Promise<void> {
    return this.broadcast.launchBroadcast(campaignRef)
  }

  abortBroadcast(campaignRef: string): Promise<void> {
    return this.broadcast.abortBroadcast(campaignRef)
  }

  getBroadcastStatus(campaignRef: string): Promise<RobocallBroadcastStatus> {
    return this.broadcast.getBroadcastStatus(campaignRef)
  }

  getCompletedCount(campaignRef: string): Promise<CompletedCount> {
    return this.results.getCompletedCount(campaignRef)
  }

  partitionByDnc(numbers: string[]): Promise<DncPartition> {
    return this.dnc.partitionByDnc(numbers)
  }

  private async downloadCsv(csvUrl: string): Promise<Buffer> {
    const response = await fetch(csvUrl)
    if (!response.ok) {
      throw new BadGatewayException(
        `Failed to download audience CSV (${response.status})`,
      )
    }
    return Buffer.from(await response.arrayBuffer())
  }

  // Polls the list's async validation to a terminal state. Returns the validated
  // row count once ACTIVE; throws on a terminal FAILED status or if validation
  // never settles inside the poll window. A transient vendor error (a plain
  // BadGatewayException) is retried within the poll window; a VendorPermanentError
  // (a permanent 4xx, e.g. list-not-found) or any other error propagates at once.
  private async waitForListReady(listId: string): Promise<number> {
    for (let attempt = 0; attempt < LIST_POLL_ATTEMPTS; attempt++) {
      await sleep(LIST_POLL_DELAY_MS)
      let status: ContactListStatus
      try {
        status = await this.contacts.getListStatus(listId)
      } catch (err) {
        if (
          !(err instanceof BadGatewayException) ||
          err instanceof VendorPermanentError
        )
          throw err
        this.logger.warn(
          { listId, attempt, err },
          'Transient error polling CallFire list status; retrying',
        )
        continue
      }
      if (status.isFailed) {
        throw new VendorPermanentError(
          `CallFire list ${listId} validation failed (${status.status})`,
        )
      }
      if (status.isReady) return status.size ?? 0
    }

    throw new BadGatewayException(
      `CallFire list ${listId} did not validate within the poll window`,
    )
  }
}

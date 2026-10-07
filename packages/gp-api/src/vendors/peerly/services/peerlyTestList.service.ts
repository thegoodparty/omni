import { ConflictException, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { sleep } from '@/shared/util/sleep.util'
import { PhoneListState } from '../peerly.types'
import {
  PeerlyPhoneListService,
  TEST_SUPPRESS_CELL_PHONES,
} from './peerlyPhoneList.service'

// Peerly will only text a number that sits on a "test list" — a phone
// list uploaded in test mode, holding at most 5 numbers, scoped to one
// identity — and its send-test call takes that list's id alongside the
// number (https://api-docs.peerly.com/reference/send-test-message). The
// per-identity test-list cap is why this resolves to ONE list per
// identity and adds numbers to it, instead of uploading a list per click.
const TEST_LIST_NAME_PREFIX = 'GoodParty test list'

// A fresh upload processes asynchronously at Peerly. The admin request
// waits only as long as a reviewer will sit in front of a dialog; past
// that the operator is told to try again, and the next click finds the
// list ready rather than uploading a second one.
const READY_TIMEOUT_MS = 20_000
const POLL_INTERVAL_MS = 2_000

const PREPARING_MESSAGE =
  'Peerly is still preparing this campaign\u2019s test list — try the ' +
  'test again in a minute'

@Injectable()
export class PeerlyTestListService {
  constructor(
    private readonly peerlyPhoneListService: PeerlyPhoneListService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PeerlyTestListService.name)
  }

  /**
   * The id of a Peerly test list in this identity that holds `phone`,
   * creating the list on first use. Throws ConflictException while a list
   * is still processing — the caller's retry is cheap and nothing is left
   * half-done.
   */
  async resolveTestListId({
    identityId,
    phone,
  }: {
    identityId: string
    phone: string
  }): Promise<number> {
    const existingListId = await this.findTestListId(identityId)
    if (existingListId !== null) {
      await this.addContact(existingListId, phone)
      return existingListId
    }

    const token = await this.peerlyPhoneListService.uploadTestPhoneList({
      listName: `${TEST_LIST_NAME_PREFIX} ${identityId}`,
      phone,
      identityId,
    })
    this.logger.info(
      { identityId, token },
      'Created a Peerly test list for the admin test send',
    )

    const listId = await this.waitForListId(token)
    if (listId === null) {
      // The list is Peerly's now and findTestListId will pick it up once
      // it finishes, so this is a wait, not a failure.
      throw new ConflictException(PREPARING_MESSAGE)
    }
    return listId
  }

  // An identity's test list, or null when it has none. A list still
  // processing refuses rather than returning null: uploading a second one
  // would burn the identity's test-list allowance for nothing.
  private async findTestListId(identityId: string): Promise<number | null> {
    const lists = await this.peerlyPhoneListService.listPhoneLists(identityId)
    const testLists = lists.filter(
      (list) => list.suppress_cell_phones === TEST_SUPPRESS_CELL_PHONES,
    )
    if (testLists.length === 0) return null

    const usable = testLists.filter(
      (list) => list.list_state === PhoneListState.ACTIVE,
    )
    // Prefer the list this code made; a test list a human made in Peerly's
    // console works just as well, so it is the fallback rather than ignored.
    const ours = usable.find((list) =>
      list.list_name?.startsWith(TEST_LIST_NAME_PREFIX),
    )
    const chosen = ours ?? usable[0]
    if (chosen) return chosen.list_id

    this.logger.warn(
      {
        identityId,
        states: testLists.map((list) => list.list_state),
      },
      'Identity has a Peerly test list but none is active yet',
    )
    throw new ConflictException(PREPARING_MESSAGE)
  }

  // Peerly has no way to read a list's contacts back, and re-adding a
  // number that is already there is not an error we can distinguish from
  // one that matters. So add, and let the send be the judge: if the number
  // really is missing, Peerly rejects the send with its own message, which
  // the reviewer sees.
  private async addContact(listId: number, phone: string): Promise<void> {
    try {
      await this.peerlyPhoneListService.addContactToPhoneList(listId, phone)
    } catch (error) {
      this.logger.warn(
        { listId, error },
        'Peerly refused to add the test number to the test list; sending ' +
          'anyway in case it is already on the list',
      )
    }
  }

  private async waitForListId(token: string): Promise<number | null> {
    const deadline = Date.now() + READY_TIMEOUT_MS
    for (;;) {
      const status =
        await this.peerlyPhoneListService.checkPhoneListStatus(token)
      const listId = status?.Data.list_id
      if (status?.Data.list_state === PhoneListState.ACTIVE && listId) {
        return listId
      }
      if (Date.now() + POLL_INTERVAL_MS >= deadline) return null
      await sleep(POLL_INTERVAL_MS)
    }
  }
}

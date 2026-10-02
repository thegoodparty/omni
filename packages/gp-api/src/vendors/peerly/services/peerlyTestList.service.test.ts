import { ConflictException } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { PhoneListState } from '../peerly.types'
import { PeerlyPhoneListService } from './peerlyPhoneList.service'
import { PeerlyTestListService } from './peerlyTestList.service'

describe('PeerlyTestListService', () => {
  let service: PeerlyTestListService
  let phoneLists: {
    listPhoneLists: ReturnType<typeof vi.fn>
    uploadTestPhoneList: ReturnType<typeof vi.fn>
    addContactToPhoneList: ReturnType<typeof vi.fn>
    checkPhoneListStatus: ReturnType<typeof vi.fn>
  }

  const activeTestList = {
    list_id: 169614,
    list_name: 'GoodParty test list identity-1',
    list_state: PhoneListState.ACTIVE,
    suppress_cell_phones: 6,
  }

  beforeEach(() => {
    vi.useFakeTimers()
    phoneLists = {
      listPhoneLists: vi.fn().mockResolvedValue([]),
      uploadTestPhoneList: vi.fn().mockResolvedValue('upload-token'),
      addContactToPhoneList: vi.fn().mockResolvedValue(undefined),
      checkPhoneListStatus: vi.fn().mockResolvedValue({
        Data: { list_state: PhoneListState.ACTIVE, list_id: 42 },
      }),
    }
    service = new PeerlyTestListService(
      phoneLists as unknown as PeerlyPhoneListService,
      createMockLogger() as unknown as PinoLogger,
    )
  })

  it('reuses the identity test list and puts the typed number on it', async () => {
    phoneLists.listPhoneLists.mockResolvedValue([
      { list_id: 1, list_name: 'Likely voters', suppress_cell_phones: 4 },
      activeTestList,
    ])

    const listId = await service.resolveTestListId({
      identityId: 'identity-1',
      phone: '5551234567',
    })

    expect(listId).toBe(169614)
    expect(phoneLists.addContactToPhoneList).toHaveBeenCalledWith(
      169614,
      '5551234567',
    )
    // Test lists are capped per identity — reuse must never upload.
    expect(phoneLists.uploadTestPhoneList).not.toHaveBeenCalled()
  })

  it('still sends when Peerly refuses the number it may already hold', async () => {
    phoneLists.listPhoneLists.mockResolvedValue([activeTestList])
    phoneLists.addContactToPhoneList.mockRejectedValue(
      new Error('contact invalid'),
    )

    await expect(
      service.resolveTestListId({
        identityId: 'identity-1',
        phone: '5551234567',
      }),
    ).resolves.toBe(169614)
  })

  it('creates the identity first test list and waits for it', async () => {
    const resolution = service.resolveTestListId({
      identityId: 'identity-1',
      phone: '5551234567',
    })

    await expect(resolution).resolves.toBe(42)
    expect(phoneLists.uploadTestPhoneList).toHaveBeenCalledWith({
      listName: 'GoodParty test list identity-1',
      phone: '5551234567',
      identityId: 'identity-1',
    })
    // The uploaded CSV already holds the number.
    expect(phoneLists.addContactToPhoneList).not.toHaveBeenCalled()
  })

  it('asks the reviewer to retry while a new list is still processing', async () => {
    phoneLists.checkPhoneListStatus.mockResolvedValue({
      Data: { list_state: PhoneListState.PROCESSING },
    })

    const resolution = service.resolveTestListId({
      identityId: 'identity-1',
      phone: '5551234567',
    })
    const assertion = expect(resolution).rejects.toThrow(ConflictException)
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
  })

  it('refuses rather than uploading a second list when one is pending', async () => {
    phoneLists.listPhoneLists.mockResolvedValue([
      { ...activeTestList, list_state: PhoneListState.PENDING },
    ])

    await expect(
      service.resolveTestListId({
        identityId: 'identity-1',
        phone: '5551234567',
      }),
    ).rejects.toThrow(ConflictException)
    expect(phoneLists.uploadTestPhoneList).not.toHaveBeenCalled()
  })

  it('uses a test list a human made in Peerly when we have none of our own', async () => {
    phoneLists.listPhoneLists.mockResolvedValue([
      {
        list_id: 777,
        list_name: 'CAS handsets',
        list_state: PhoneListState.ACTIVE,
        suppress_cell_phones: 6,
      },
    ])

    await expect(
      service.resolveTestListId({
        identityId: 'identity-1',
        phone: '5551234567',
      }),
    ).resolves.toBe(777)
  })
})

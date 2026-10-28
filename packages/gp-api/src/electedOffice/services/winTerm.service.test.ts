import { describe, expect, it, vi } from 'vitest'
import type { OfficeHoldersService } from '@/electionDb/officeHolders/officeHolders.service'
import type { PinoLogger } from 'nestjs-pino'
import { WinTermService } from './winTerm.service'

const NOW = new Date('2026-11-10T00:00:00Z')

const holder = (overrides: Record<string, unknown> = {}) => ({
  startAt: new Date('2026-12-01'),
  endAt: new Date('2030-12-01'),
  termDateSpecificity: 'day',
  Person: { firstName: 'Sarah', lastName: 'Chen' },
  ...overrides,
})

const serviceWith = (holders: unknown[] | Error) => {
  const findMany =
    holders instanceof Error
      ? vi.fn().mockRejectedValue(holders)
      : vi.fn().mockResolvedValue(holders)
  const officeHolders = {
    model: { findMany },
  } as unknown as OfficeHoldersService
  const logger = {
    setContext: vi.fn(),
    error: vi.fn(),
  } as unknown as PinoLogger
  return {
    service: new WinTermService(officeHolders, logger),
    findMany,
    logger,
  }
}

const sarah = { firstName: 'Sarah', lastName: 'Chen' }

describe('WinTermService.forWinner', () => {
  it("takes the winner's own record for the seat", async () => {
    const { service, findMany } = serviceWith([
      holder({ Person: { firstName: 'Old', lastName: 'Holder' } }),
      holder({ Person: { firstName: ' sarah ', lastName: 'CHEN' } }),
    ])

    await expect(service.forWinner('pos-1', sarah, NOW)).resolves.toEqual({
      termStartDate: new Date('2026-12-01'),
      termEndDate: new Date('2030-12-01'),
    })
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { positionId: 'pos-1', isVacant: { not: true } },
      }),
    )
  })

  it('prefers the newest term when the winner held the seat before', async () => {
    const { service } = serviceWith([
      holder({
        startAt: new Date('2022-12-01'),
        endAt: new Date('2026-12-01'),
      }),
      holder(),
    ])

    await expect(service.forWinner('pos-1', sarah, NOW)).resolves.toEqual({
      termStartDate: new Date('2026-12-01'),
      termEndDate: new Date('2030-12-01'),
    })
  })

  it.each([
    [
      'someone else holds the seat',
      { Person: { firstName: 'Ann', lastName: 'Lee' } },
    ],
    ['the record has no end', { endAt: null }],
    ['the record has no start', { startAt: null }],
    ['the term is over', { endAt: new Date('2026-01-01') }],
    ['the dates are year-only', { termDateSpecificity: 'year' }],
  ])('asks instead when %s', async (_, overrides) => {
    const { service } = serviceWith([holder(overrides)])

    await expect(service.forWinner('pos-1', sarah, NOW)).resolves.toBeNull()
  })

  it('logs a failed lookup and asks instead of failing the win', async () => {
    const err = new Error('election db down')
    const { service, logger } = serviceWith(err)

    await expect(service.forWinner('pos-1', sarah, NOW)).resolves.toBeNull()
    expect(logger.error).toHaveBeenCalledWith(
      { err, positionId: 'pos-1' },
      expect.any(String),
    )
  })

  it('never looks without a position or a full name', async () => {
    const { service, findMany } = serviceWith([holder()])

    await expect(service.forWinner(null, sarah, NOW)).resolves.toBeNull()
    await expect(
      service.forWinner('pos-1', { firstName: 'Sarah', lastName: null }, NOW),
    ).resolves.toBeNull()
    expect(findMany).not.toHaveBeenCalled()
  })
})

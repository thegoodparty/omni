import { BadRequestException } from '@nestjs/common'
import { Campaign } from '../../../generated/prisma'
import { PinoLogger } from 'nestjs-pino'
import { describe, expect, it, vi } from 'vitest'
import { VoterFileType } from '../voterFile.types'
import { CustomFilter } from '../../../shared/types/voter.types'
import { typeToQuery } from './voterFile.util'

const logger = {
  debug: vi.fn(),
  warn: vi.fn(),
} as unknown as PinoLogger

const statewideCampaign = (state: string | null | undefined) =>
  ({
    id: 1,
    organizationSlug: 'test-org',
    details: { state },
  }) as unknown as Campaign

const statewideDistrict = {
  id: 'dist-1',
  state: 'CO',
  l2Type: 'State',
  l2Name: 'CO',
}

describe('typeToQuery state validation', () => {
  it('throws BadRequestException for an invalid state', () => {
    expect(() =>
      typeToQuery(
        logger,
        VoterFileType.full,
        statewideCampaign('XX'),
        statewideDistrict,
      ),
    ).toThrow(BadRequestException)
  })

  it('does not throw for a valid uppercase state', () => {
    const sql = typeToQuery(
      logger,
      VoterFileType.full,
      statewideCampaign('CO'),
      statewideDistrict,
    )
    expect(sql).toContain('FROM public."VoterCO"')
  })

  it('accepts a lowercase state by uppercasing it', () => {
    const sql = typeToQuery(
      logger,
      VoterFileType.full,
      statewideCampaign('co'),
      statewideDistrict,
    )
    expect(sql).toContain('FROM public."VoterCO"')
  })

  it('throws when state is undefined', () => {
    expect(() =>
      typeToQuery(
        logger,
        VoterFileType.full,
        statewideCampaign(undefined),
        statewideDistrict,
      ),
    ).toThrow(BadRequestException)
  })

  it('throws when state is null', () => {
    expect(() =>
      typeToQuery(
        logger,
        VoterFileType.full,
        statewideCampaign(null),
        statewideDistrict,
      ),
    ).toThrow(BadRequestException)
  })

  it('throws for a SQL injection payload', () => {
    expect(() =>
      typeToQuery(
        logger,
        VoterFileType.full,
        statewideCampaign('CO"; SELECT pg_sleep(10);--'),
        statewideDistrict,
      ),
    ).toThrow(BadRequestException)
  })
})

describe('typeToQuery SMS custom filters', () => {
  const smsQuery = (filters: CustomFilter[]) =>
    typeToQuery(
      logger,
      VoterFileType.sms,
      statewideCampaign('CO'),
      statewideDistrict,
      { filters, channel: 'SMS Texting', purpose: 'GOTV' },
    )

  it('maps has_cell_phone / has_landline to presence checks', () => {
    const sql = smsQuery(['has_cell_phone', 'has_landline'])
    expect(sql).toContain(
      '("VoterTelephones_CellPhoneFormatted" IS NOT NULL OR ' +
        '"VoterTelephones_LandlineFormatted" IS NOT NULL)',
    )
  })

  it('maps ethnicity filters to EthnicGroups_EthnicGroup1Desc', () => {
    const sql = smsQuery([
      'ethnicity_european',
      'ethnicity_asian',
      'ethnicity_hispanic',
      'ethnicity_african_american',
    ])
    expect(sql).toContain(
      '("EthnicGroups_EthnicGroup1Desc" = \'European\' OR ' +
        '"EthnicGroups_EthnicGroup1Desc" LIKE \'%Asian%\' OR ' +
        '"EthnicGroups_EthnicGroup1Desc" LIKE \'%Hispanic%\' OR ' +
        '"EthnicGroups_EthnicGroup1Desc" LIKE \'%African%\')',
    )
  })

  it('AND-combines distinct filter categories', () => {
    const sql = smsQuery(['party_democrat', 'has_cell_phone'])
    expect(sql).toContain(
      '("Parties_Description" = \'Democratic\') AND ' +
        '("VoterTelephones_CellPhoneFormatted" IS NOT NULL)',
    )
  })
})

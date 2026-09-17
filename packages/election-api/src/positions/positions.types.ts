import { Position } from '../generated/prisma'
import type { FilingFeeExtractionSource } from './util/filingFee.util'

export type PositionWithOptionalDistrict = Pick<
  Position,
  'id' | 'brPositionId' | 'brDatabaseId' | 'state' | 'isWinIcp' | 'isServeIcp'
> & {
  name?: string | null
  level: Position['level']
  district?: {
    id: string
    state: string
    L2DistrictType: string
    L2DistrictName: string
  }
  filingFee?: number | null
  filingRequirementsText?: string | null
  filingFeeExtractionSource?: FilingFeeExtractionSource | null
}

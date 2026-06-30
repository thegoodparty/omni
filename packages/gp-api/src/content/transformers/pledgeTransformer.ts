import { Transformer, PledgeAugmented, PledgeRaw } from '../content.types'

export const pledgeTransformer: Transformer<PledgeRaw, PledgeAugmented> = (
  pledges: PledgeRaw[],
): PledgeAugmented => {
  const first = pledges[0]
  if (!first) {
    throw new Error('pledgeTransformer requires at least one pledge')
  }
  return { ...first.data }
}

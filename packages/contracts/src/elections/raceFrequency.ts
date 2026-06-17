import { z } from 'zod'

// Response of election-api `GET /races/by-br-hash-id/:brHashId/frequency`.
// `frequency` is the BallotReady PositionElection cadence (`Race.frequency`,
// an Int[] of inter-election year gaps); `electionDate` is the matched race's
// election day. Both default empty/null when no race matches the hash, so the
// consumer treats "no match" and "matched but no frequency" identically.
export const RaceFrequencyByBrHashSchema = z.object({
  frequency: z.array(z.number()),
  electionDate: z.string().nullable(),
})

export type RaceFrequencyByBrHash = z.infer<typeof RaceFrequencyByBrHashSchema>

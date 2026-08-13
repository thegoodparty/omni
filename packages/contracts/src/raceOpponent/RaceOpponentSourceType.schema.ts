// Mirrors the Prisma RaceOpponentSourceType enum. Re-exported from the
// generated enum (source of truth) so the values can't drift, and kept in its
// own module to avoid an import cycle between RaceOpponent and
// RaceOpponentSummary (both reference it).
export {
  RACE_OPPONENT_SOURCE_TYPE_VALUES,
  RaceOpponentSourceTypeSchema,
  type RaceOpponentSourceType,
} from '../generated/enums'

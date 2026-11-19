-- AlterEnum
-- An office prepared for an ever-Pro campaign that has reached its election
-- date with no result yet. Postgres appends an added value to the end of the
-- type, so the declaration order in schema.prisma does not have to match.
ALTER TYPE "ElectedOfficeWinSource" ADD VALUE 'pending';

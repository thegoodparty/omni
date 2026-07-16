-- AlterEnum
ALTER TYPE "DashboardCardType" ADD VALUE 'community_issue';

-- AlterTable
-- Rename in place (NOT drop+add) so existing cards keep their source id. The
-- column generalizes from "briefing id" to "external id of the governing source
-- row"; `type` discriminates which table it points into.
ALTER TABLE "dashboard_card" RENAME COLUMN "source_briefing_id" TO "source_external_id";

-- AlterIndex
-- Rename the unique index to the Prisma-derived name for the new column list so
-- `prisma migrate diff` sees no drift.
ALTER INDEX "dashboard_card_elected_office_id_type_source_briefing_id_so_key" RENAME TO "dashboard_card_elected_office_id_type_source_external_id_so_key";

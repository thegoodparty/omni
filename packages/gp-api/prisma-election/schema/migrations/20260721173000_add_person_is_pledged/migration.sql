-- GoodParty pledge status on the person spine. Rolled up from candidacies by
-- the gp-data-platform person mart; read-only for the API.

-- AlterTable
ALTER TABLE "Person" ADD COLUMN "is_pledged" BOOLEAN NOT NULL DEFAULT false;

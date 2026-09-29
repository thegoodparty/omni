-- Forwarding addresses for purged duplicate persons. Populated by the
-- gp-data-platform ETL in the same run as the Person delete; read-only for the
-- API. See dbt/project/models/marts/civics/PERSON_ID_RETIREMENT_HANDOFF.md.
--
-- No foreign keys, deliberately. retired_id names a Person row that has been
-- deleted (that is the point of the record), and surviving_id must tolerate a
-- survivor that is itself later retired without failing the write.
--
-- Many retired ids may share one surviving_id — several duplicates of the same
-- person collapsing into one keeper is the normal case. The primary key is
-- retired_id alone, so a retired id always has exactly one successor and the
-- /people redirect stays unambiguous.

-- CreateTable
CREATE TABLE "PersonMerge" (
    "retired_id" UUID NOT NULL,
    "surviving_id" UUID NOT NULL,
    "retired_slug" TEXT,
    "retired_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonMerge_pkey" PRIMARY KEY ("retired_id")
);

-- CreateIndex
CREATE INDEX "PersonMerge_retired_at_idx" ON "PersonMerge"("retired_at");

-- CreateIndex
CREATE INDEX "PersonMerge_surviving_id_idx" ON "PersonMerge"("surviving_id");

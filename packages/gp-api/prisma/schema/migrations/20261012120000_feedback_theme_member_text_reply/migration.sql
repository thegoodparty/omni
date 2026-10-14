-- A theme's member can now be a constituent's text reply as well as a
-- confirmed memo: SMS replies on a Serve text send are synthesized into the
-- same themes door-knock and phone-bank notes are (decided 2026-10-12).
--
-- The composite key (theme_id, feedback_id) cannot hold a nullable column,
-- so the row gets a surrogate id and two unique pairs take over the
-- "written once per theme" role. Existing rows are backfilled with
-- gen_random_uuid(); Prisma mints uuid v7 for new ones, and nothing reads
-- the id's ordering.
--
-- Hand-written: `prisma migrate diff` cannot express the CHECK, and would
-- add the NOT NULL id column with no value for existing rows.

-- DropPrimaryKey
ALTER TABLE "feedback_theme_member" DROP CONSTRAINT "feedback_theme_member_pkey";

-- AlterTable
ALTER TABLE "feedback_theme_member" ADD COLUMN "id" TEXT;
UPDATE "feedback_theme_member" SET "id" = gen_random_uuid()::text;
ALTER TABLE "feedback_theme_member" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "feedback_theme_member" ADD CONSTRAINT "feedback_theme_member_pkey" PRIMARY KEY ("id");

ALTER TABLE "feedback_theme_member" ALTER COLUMN "feedback_id" DROP NOT NULL,
ADD COLUMN "text_reply_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "feedback_theme_member_theme_id_feedback_id_key" ON "feedback_theme_member"("theme_id", "feedback_id");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_theme_member_theme_id_text_reply_id_key" ON "feedback_theme_member"("theme_id", "text_reply_id");

-- AddForeignKey
ALTER TABLE "feedback_theme_member" ADD CONSTRAINT "feedback_theme_member_text_reply_id_fkey" FOREIGN KEY ("text_reply_id") REFERENCES "poll_individual_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one source per member, like poll_individual_message_scope_check.
-- A plain ADD CONSTRAINT: the table holds one row per memo per theme on a
-- feature a few weeks old, so the validation scan is short and the lock is
-- not worth splitting across two migrations.
ALTER TABLE "feedback_theme_member" ADD CONSTRAINT "feedback_theme_member_source_check"
  CHECK (num_nonnulls("feedback_id", "text_reply_id") = 1);

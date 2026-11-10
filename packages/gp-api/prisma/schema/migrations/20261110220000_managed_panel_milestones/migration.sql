-- CreateEnum
CREATE TYPE "CivicPanelMilestone" AS ENUM ('first_yes', 'can_compare', 'halfway', 'full');

-- CreateTable
CREATE TABLE "managed_panel_milestone" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enrollment_id" TEXT NOT NULL,
    "milestone" "CivicPanelMilestone" NOT NULL,
    "members" INTEGER NOT NULL,

    CONSTRAINT "managed_panel_milestone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "managed_panel_milestone_enrollment_id_milestone_key" ON "managed_panel_milestone"("enrollment_id", "milestone");

-- AddForeignKey
ALTER TABLE "managed_panel_milestone" ADD CONSTRAINT "managed_panel_milestone_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "managed_civic_panel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Milestones existing panels already passed are recorded without an event,
-- so the first run after this deploy does not announce them as new.
WITH panels AS (
    SELECT
        p."id",
        p."status",
        p."goal_members",
        (
            SELECT count(*)::int FROM "contact_current_status" s
            WHERE s."organization_slug" = p."organization_slug"
              AND s."field" = 'civic_panel'
              AND s."value" = 'member'
        ) AS "members"
    FROM "managed_civic_panel" p
)
INSERT INTO "managed_panel_milestone" ("id", "enrollment_id", "milestone", "members")
SELECT gen_random_uuid()::text, panels."id", m."milestone"::"CivicPanelMilestone", panels."members"
FROM panels
CROSS JOIN LATERAL (
    VALUES
        ('first_yes', 1),
        ('can_compare', 30),
        ('halfway', ceil(panels."goal_members" / 2.0)::int),
        ('full', panels."goal_members")
) AS m("milestone", "at")
WHERE panels."members" >= m."at"
   OR (m."milestone" = 'full' AND panels."status" = 'ready');

-- AlterTable
ALTER TABLE "managed_civic_panel" DROP COLUMN "ready_email_sent_at";

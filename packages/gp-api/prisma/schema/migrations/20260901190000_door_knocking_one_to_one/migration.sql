-- Door knocking 3.0: outreach -> turf -> route becomes a real 1:1:1 chain,
-- written in one transaction at list creation, and the list lifecycle moves
-- off the turf onto the envelope.
--
-- The four steps are order-dependent: the backfill has to create the missing
-- envelopes before the lifecycle copy can write to them, and the copy has to
-- read the turf's columns before the drop removes them.

-- 1. A turf with no route is a drawing from the old two-step flow, where the
-- polygon was saved first and the route bought later from the Knock button.
-- Nothing was frozen and nothing was billed for one, and 3.0 has no state it
-- can exist in — a route cannot be added retroactively without spending
-- Geoapify credits nobody authorized. The reusable audience survives: these
-- turfs' voter_file_filter rows are not touched.
DELETE FROM "door_knocking_turf" t
WHERE NOT EXISTS (
    SELECT 1
    FROM "door_knocking_route" r
    WHERE r."door_knocking_turf_id" = t."id"
);

-- 2. Serve orgs knock without a campaign, and the knock transaction skipped
-- the envelope entirely for them (`if (campaign)`), so their routes have none
-- at all. Give each one an envelope scoped by organization alone: campaignId
-- null is the dual-scope idiom every other channel already uses to keep a
-- Serve row off the Win history list (ENG-10976), and the CHECK added in step
-- 4 requires the row to exist.
--
-- The route's created_at is the knock moment, which is what the transaction
-- wrote into `date` for the Win rows, so the backfilled rows sort alongside
-- them rather than all landing at the migration timestamp.
INSERT INTO "outreach" (
    "createdAt",
    "updatedAt",
    "campaignId",
    "organization_slug",
    "outreach_type",
    "status",
    "name",
    "voter_file_filter_id",
    "door_knocking_route_id",
    "date",
    "archived_at"
)
SELECT
    r."created_at",
    r."created_at",
    NULL,
    f."organization_slug",
    'nativeDoorKnocking'::"OutreachType",
    CASE
        WHEN t."completed_at" IS NOT NULL THEN 'completed'::"OutreachStatus"
        ELSE 'in_progress'::"OutreachStatus"
    END,
    t."name",
    t."voter_file_filter_id",
    r."id",
    r."created_at",
    t."archived_at"
FROM "door_knocking_route" r
JOIN "door_knocking_turf" t ON t."id" = r."door_knocking_turf_id"
JOIN "voter_file_filter" f ON f."id" = t."voter_file_filter_id"
WHERE NOT EXISTS (
    SELECT 1
    FROM "outreach" o
    WHERE o."door_knocking_route_id" = r."id"
);

-- 3. The turf was the source of truth and the envelope a mirror written
-- alongside it, so copy the turf's answer over the envelope's unconditionally
-- rather than trusting what is there. That is the point of doing it here: a
-- list archived before the mirror shipped, or completed in a request whose
-- second write was missed, has an envelope that never followed, and after
-- this migration the envelope is the only copy left.
UPDATE "outreach" o
SET
    "status" = CASE
        WHEN t."completed_at" IS NOT NULL THEN 'completed'::"OutreachStatus"
        ELSE 'in_progress'::"OutreachStatus"
    END,
    "archived_at" = t."archived_at"
FROM "door_knocking_route" r
JOIN "door_knocking_turf" t ON t."id" = r."door_knocking_turf_id"
WHERE o."door_knocking_route_id" = r."id";

-- 4. Drop the turf's half of the lifecycle, and make the 1:1:1 chain a
-- constraint rather than a convention. Steps 1 and 2 leave every
-- nativeDoorKnocking row with a route, so this validates on the spot.
ALTER TABLE "door_knocking_turf" DROP COLUMN "completed_at",
DROP COLUMN "archived_at";

ALTER TABLE "outreach" ADD CONSTRAINT "outreach_native_door_knocking_route_check"
    CHECK (
        "outreach_type" <> 'nativeDoorKnocking'::"OutreachType"
        OR "door_knocking_route_id" IS NOT NULL
    );

-- The door-knocking envelope hangs off the TURF, not the route.
--
-- Creating a turf used to buy its route in the same transaction, so hanging
-- the envelope off the route cost nothing: the two always existed together.
-- The route is bought at first knock now, which opens a window where a turf
-- exists and a route does not — and an envelope reached only through the
-- route would have had nowhere to live in that window, taking the campaign's
-- name, its status and its whole outreach-history row with it.
--
-- `door_knocking_route_id` stays and stays unique. Once a route exists it is
-- still how the walk is reached, and turf -> route is still 1:1. What changes
-- is which of the two the envelope is required to have.

-- 1. The new link, nullable for now so the backfill has somewhere to land.
ALTER TABLE "outreach" ADD COLUMN "door_knocking_turf_id" INTEGER;

-- 2. Backfill through the join the envelope already had. Every existing
-- door-knocking envelope has a route (the CHECK dropped in step 5 has been
-- enforcing exactly that), and every route has a unique turf, so this
-- resolves one turf per envelope.
UPDATE "outreach" o
SET "door_knocking_turf_id" = r."door_knocking_turf_id"
FROM "door_knocking_route" r
WHERE o."door_knocking_route_id" = r."id";

-- 3. Fail here rather than at the constraint. If any envelope did not
-- resolve, the CHECK in step 5 would refuse to validate and the deploy would
-- stop with "constraint is violated by some row" and no way to tell which.
-- This says how many and stops before anything structural is added.
DO $$
DECLARE
    orphaned bigint;
BEGIN
    SELECT count(*) INTO orphaned
    FROM "outreach"
    WHERE "outreach_type" = 'nativeDoorKnocking'::"OutreachType"
      AND "door_knocking_turf_id" IS NULL;

    IF orphaned > 0 THEN
        RAISE EXCEPTION
            'door-knocking envelope backfill incomplete: % nativeDoorKnocking row(s) resolved no turf through door_knocking_route_id',
            orphaned;
    END IF;
END $$;

-- 4. Now the structure, on data known to be clean.
CREATE UNIQUE INDEX "outreach_door_knocking_turf_id_key" ON "outreach"("door_knocking_turf_id");

ALTER TABLE "outreach" ADD CONSTRAINT "outreach_door_knocking_turf_id_fkey"
    FOREIGN KEY ("door_knocking_turf_id") REFERENCES "door_knocking_turf"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Move the invariant. A nativeDoorKnocking envelope must still point at
-- exactly one thing — but at the turf, which exists from creation, rather
-- than the route, which does not exist until someone walks it.
ALTER TABLE "outreach" DROP CONSTRAINT "outreach_native_door_knocking_route_check";

ALTER TABLE "outreach" ADD CONSTRAINT "outreach_native_door_knocking_turf_check"
    CHECK (
        "outreach_type" <> 'nativeDoorKnocking'::"OutreachType"
        OR "door_knocking_turf_id" IS NOT NULL
    );

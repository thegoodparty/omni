-- The stops hang off the TURF, not the route.
--
-- A turf's doors are its audience, frozen when the turf is drawn. The route
-- is the ORDER those doors are walked in, bought later. Keeping the stops on
-- the route meant the audience was not resolved until the purchase, so a turf
-- drawn in March and bought in June routed against June's roster — and the
-- 150-stop cap is checked when the turf is drawn, so a turf that grew past it
-- in between became permanently unbuyable, discovered by a canvasser standing
-- at the first door.
--
-- Freezing at creation also means an unwalked campaign can report its doors
-- and people, which is the whole point of a details page you can look at
-- before anybody walks anything.
--
-- `seq`, `leg_seconds` and `leg_meters` are the route's contribution and
-- become nullable with it: they are written when the route is bought.

-- 1. The new parent, nullable for the backfill.
ALTER TABLE "door_knocking_stop" ADD COLUMN "door_knocking_turf_id" INTEGER;

-- 2. Backfill through the route every existing stop already has.
UPDATE "door_knocking_stop" s
SET "door_knocking_turf_id" = r."door_knocking_turf_id"
FROM "door_knocking_route" r
WHERE s."door_knocking_route_id" = r."id";

-- 3. Fail here rather than at SET NOT NULL, which would report only that a
-- null exists and not how many or why.
DO $$
DECLARE
    orphaned bigint;
BEGIN
    SELECT count(*) INTO orphaned
    FROM "door_knocking_stop"
    WHERE "door_knocking_turf_id" IS NULL;

    IF orphaned > 0 THEN
        RAISE EXCEPTION
            'door-knocking stop backfill incomplete: % stop(s) resolved no turf through door_knocking_route_id',
            orphaned;
    END IF;
END $$;

-- 4. Now the structure, on data known to be clean.
ALTER TABLE "door_knocking_stop" ALTER COLUMN "door_knocking_turf_id" SET NOT NULL;

ALTER TABLE "door_knocking_stop" ADD CONSTRAINT "door_knocking_stop_door_knocking_turf_id_fkey"
    FOREIGN KEY ("door_knocking_turf_id") REFERENCES "door_knocking_turf"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. The walk order moves with the route that decides it. A CHECK passes for
-- NULL, so `door_knocking_stop_seq_within_cap` keeps bounding a seq that is
-- set without rejecting one that is not yet.
ALTER TABLE "door_knocking_stop" ALTER COLUMN "seq" DROP NOT NULL;
ALTER TABLE "door_knocking_stop" ALTER COLUMN "leg_seconds" DROP NOT NULL;
ALTER TABLE "door_knocking_stop" ALTER COLUMN "leg_meters" DROP NOT NULL;

-- 6. One walk order per turf. Postgres allows many NULLs in a unique index,
-- so an unrouted turf's stops do not collide with each other.
DROP INDEX "door_knocking_stop_door_knocking_route_id_seq_key";
CREATE UNIQUE INDEX "door_knocking_stop_door_knocking_turf_id_seq_key"
    ON "door_knocking_stop"("door_knocking_turf_id", "seq");

-- 7. The route id is redundant once the turf owns the stops: turf -> route is
-- 1:1, so the route is one hop away when a caller actually wants it.
ALTER TABLE "door_knocking_stop" DROP CONSTRAINT "door_knocking_stop_door_knocking_route_id_fkey";
ALTER TABLE "door_knocking_stop" DROP COLUMN "door_knocking_route_id";

-- Seeds the ledger with spend that predates it. assertWaypointQuota used to sum
-- door_knocking_stop rows; the moment it starts reading this table instead, every
-- knock already billed inside the rolling 24-hour window would stop counting and
-- hand the same daily allowance out a second time. One row per existing route,
-- stamped with the route's own createdAt so the window arithmetic is unchanged.
--
-- Data-only: no schema change, so `prisma migrate diff` stays clean.
INSERT INTO "door_knocking_route_planner_spend" (
    "occurred_at",
    "organization_slug",
    "door_knocking_turf_id",
    "waypoints",
    "credits"
)
SELECT
    r."created_at",
    f."organization_slug",
    r."door_knocking_turf_id",
    COUNT(s."id"),
    r."credits"
FROM "door_knocking_route" r
JOIN "door_knocking_turf" t ON t."id" = r."door_knocking_turf_id"
JOIN "voter_file_filter" f ON f."id" = t."voter_file_filter_id"
LEFT JOIN "door_knocking_stop" s ON s."door_knocking_route_id" = r."id"
GROUP BY r."id", f."organization_slug";

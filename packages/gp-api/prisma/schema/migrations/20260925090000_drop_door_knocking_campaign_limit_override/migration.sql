-- The daily door-knocking campaign allowance is gone, so the column that
-- raised it for one organization has nothing left to raise.
--
-- The cap existed because creating a turf bought a Geoapify route. Routes are
-- bought at first knock now, so creating turfs is free and pacing it rations
-- nothing. What bounds door-knocking spend is the account-wide tiered
-- alerting over door_knocking_route_planner_spend, which is what bounded the
-- shared credit pool all along.
ALTER TABLE "organization" DROP COLUMN "override_door_knocking_campaign_limit";

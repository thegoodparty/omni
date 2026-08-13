-- CreateTable
CREATE TABLE "door_knocking_route_planner_spend" (
    "id" SERIAL NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_slug" TEXT NOT NULL,
    "door_knocking_turf_id" INTEGER,
    "waypoints" INTEGER NOT NULL,
    "credits" INTEGER NOT NULL,

    CONSTRAINT "door_knocking_route_planner_spend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "door_knocking_route_planner_spend_organization_slug_occurre_idx" ON "door_knocking_route_planner_spend"("organization_slug", "occurred_at");

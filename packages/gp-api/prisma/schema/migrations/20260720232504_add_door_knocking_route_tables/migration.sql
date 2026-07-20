-- CreateEnum
CREATE TYPE "DoorKnockingMode" AS ENUM ('walk', 'drive');

-- AlterEnum
ALTER TYPE "OutreachType" ADD VALUE 'nativeDoorKnocking';

-- AlterTable
ALTER TABLE "outreach" ADD COLUMN     "door_knocking_route_id" INTEGER;

-- CreateTable
CREATE TABLE "door_knocking_route" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "door_knocking_turf_id" INTEGER NOT NULL,
    "mode" "DoorKnockingMode" NOT NULL,
    "loop" BOOLEAN NOT NULL,
    "total_seconds" INTEGER NOT NULL,
    "total_meters" INTEGER NOT NULL,
    "credits" INTEGER NOT NULL,

    CONSTRAINT "door_knocking_route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "door_knocking_stop" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "door_knocking_route_id" INTEGER NOT NULL,
    "seq" SMALLINT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "display_address" TEXT NOT NULL,
    "leg_seconds" INTEGER NOT NULL,
    "leg_meters" INTEGER NOT NULL,

    CONSTRAINT "door_knocking_stop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "door_knocking_stop_target" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "door_knocking_stop_id" INTEGER NOT NULL,
    "person_id" TEXT NOT NULL,
    "name" TEXT,
    "address_key" TEXT NOT NULL,

    CONSTRAINT "door_knocking_stop_target_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "door_knocking_turf" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "voter_file_filter_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "geo_poly" JSONB NOT NULL,

    CONSTRAINT "door_knocking_turf_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "door_knocking_route_door_knocking_turf_id_key" ON "door_knocking_route"("door_knocking_turf_id");

-- CreateIndex
CREATE UNIQUE INDEX "door_knocking_stop_door_knocking_route_id_seq_key" ON "door_knocking_stop"("door_knocking_route_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "door_knocking_stop_target_door_knocking_stop_id_person_id_key" ON "door_knocking_stop_target"("door_knocking_stop_id", "person_id");

-- CreateIndex
CREATE INDEX "door_knocking_turf_voter_file_filter_id_idx" ON "door_knocking_turf"("voter_file_filter_id");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_door_knocking_route_id_key" ON "outreach"("door_knocking_route_id");

-- AddForeignKey
ALTER TABLE "door_knocking_route" ADD CONSTRAINT "door_knocking_route_door_knocking_turf_id_fkey" FOREIGN KEY ("door_knocking_turf_id") REFERENCES "door_knocking_turf"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "door_knocking_stop" ADD CONSTRAINT "door_knocking_stop_door_knocking_route_id_fkey" FOREIGN KEY ("door_knocking_route_id") REFERENCES "door_knocking_route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "door_knocking_stop_target" ADD CONSTRAINT "door_knocking_stop_target_door_knocking_stop_id_fkey" FOREIGN KEY ("door_knocking_stop_id") REFERENCES "door_knocking_stop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "door_knocking_turf" ADD CONSTRAINT "door_knocking_turf_voter_file_filter_id_fkey" FOREIGN KEY ("voter_file_filter_id") REFERENCES "voter_file_filter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_door_knocking_route_id_fkey" FOREIGN KEY ("door_knocking_route_id") REFERENCES "door_knocking_route"("id") ON DELETE CASCADE ON UPDATE CASCADE;


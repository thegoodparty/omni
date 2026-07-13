-- CreateTable
CREATE TABLE "Election_Calendar" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "state" TEXT NOT NULL,
    "election_date" DATE NOT NULL,
    "election_code" "ElectionCode" NOT NULL,

    CONSTRAINT "Election_Calendar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Election_Calendar_state_election_date_key" ON "Election_Calendar"("state", "election_date");

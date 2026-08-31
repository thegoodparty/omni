-- Privacy takedowns pushed from gp-api's admin removal control. Read on every
-- person/candidacy response to null the person-sourced fields, so a removal
-- covers all consumers rather than only the profile page's render.
--
-- NOT one of the tables the gp-data-platform mart sync swap-replaces, so a
-- removal survives re-ingestion of the upstream data that prompted it.
CREATE TABLE "PersonRemoval" (
    "person_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "PersonRemoval_pkey" PRIMARY KEY ("person_id")
);

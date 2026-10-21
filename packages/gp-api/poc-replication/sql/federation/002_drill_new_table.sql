-- Path A schema drill, part 1: what `prisma migrate` generates for a new model.
-- Run as poc_admin so the default privileges from 001 apply.
CREATE TABLE IF NOT EXISTS "poc_federation_drill" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "poc_federation_drill_pkey" PRIMARY KEY ("id")
);

INSERT INTO "poc_federation_drill" ("label") VALUES ('drill');

-- AlterTable
-- Added nullable first, backfilled from created_at (the only sane value for
-- a pre-existing row — nothing has touched it since), then locked to
-- NOT NULL. No DB-level default: Prisma's `@updatedAt` sets it client-side on
-- every write, matching every other plain `@updatedAt` column in this schema
-- (e.g. campaign.prisma, aiChat.prisma).
ALTER TABLE "peerly_phone_list" ADD COLUMN "updated_at" TIMESTAMP(3);

UPDATE "peerly_phone_list" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;

ALTER TABLE "peerly_phone_list" ALTER COLUMN "updated_at" SET NOT NULL;

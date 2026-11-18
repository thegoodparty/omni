-- CreateTable
CREATE TABLE "db_change" (
    "id" BIGSERIAL NOT NULL,
    "table_name" TEXT NOT NULL,
    "row_key" JSONB NOT NULL,
    "op" TEXT NOT NULL,
    "old_row" JSONB,
    "new_row" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "relayed_at" TIMESTAMPTZ(3),
    CONSTRAINT "db_change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "db_change_config" (
    "id" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    CONSTRAINT "db_change_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "db_change_relay" (
    "id" INTEGER NOT NULL,
    "holder" TEXT,
    "expires_at" TIMESTAMPTZ(3),
    CONSTRAINT "db_change_relay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "db_change_relayed_at_idx" ON "db_change"("relayed_at");

-- The relay's claim reads only unsent rows, in id order. Prisma cannot
-- express a partial index, so `prisma migrate diff` ignores this one.
CREATE INDEX "db_change_unsent_idx" ON "db_change" ("id") WHERE "relayed_at" IS NULL;

-- db_change_config is one row whose `enabled` is the capture kill switch.
INSERT INTO "db_change_config" ("id", "enabled") VALUES (1, true);

-- db_change_relay is one row the relaying task leases, as email_sweep_lease.
INSERT INTO "db_change_relay" ("id") VALUES (1);

-- Originating gp-api User.id on the person spine (GP-native/originated persons).
-- Holds the gp-api User.id, which is a numeric autoincrement stored as text —
-- NOT a UUID. Populated by the gp-data-platform person mart; read-only for the
-- API and exposed filter-only (never returned / not selectable via ?columns=).
ALTER TABLE "Person" ADD COLUMN "gp_api_user_id" TEXT;
CREATE INDEX "Person_gp_api_user_id_idx" ON "Person"("gp_api_user_id");

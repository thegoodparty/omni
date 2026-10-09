-- Win SMS hold hard send cap (slice D2b): the paid text count the hold
-- authorizes for a build, persisted at checkout-session time so the build
-- upload caps to it regardless of the hold-link vs build-resolve order.
ALTER TABLE "peerly_phone_list" ADD COLUMN "send_cap_texts" INTEGER;
